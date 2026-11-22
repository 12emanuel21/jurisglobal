import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient, Role, type ContactConsentStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import request from 'supertest';
import * as XLSX from 'xlsx';
import type Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv, resetEnvCache } from '../src/config/env';
import { phoneHash } from '../src/common/crypto';
import { MailService } from '../src/mail/mail.service';
import { AuthService } from '../src/auth/auth.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { REDIS } from '../src/redis/redis.module';
import { SettingsService } from '../src/settings/settings.service';
import { WhatsAppApiError, WhatsAppCloudApi } from '../src/whatsapp/cloud-api.client';
import { WebhookProcessor } from '../src/whatsapp/webhook.processor';
import { CampaignEngine, type StepResult } from '../src/campaigns/campaign-engine';
import { CampaignQueue, bullPrefix, CAMPAIGN_QUEUE } from '../src/campaigns/campaign-queue';
import { CampaignWorkerService } from '../src/campaigns/campaign-worker';
import { CLOCK } from '../src/campaigns/clock';
import { isWithinSendWindow, localDateKey } from '../src/compliance/send-window';
import { resetDatabase } from './helpers';

// Gemini nunca se llama de verdad (el bot solo lo usa para preguntas fuera del flujo)
jest.mock('ai', () => ({
  ...jest.requireActual('ai'),
  generateObject: jest.fn(() => Promise.reject(new Error('sin IA en pruebas'))),
  generateText: jest.fn(() => Promise.reject(new Error('sin IA en pruebas'))),
}));

const SECRET = 'app-secret-masivos';
const PHONE_ID = 'PHONE_ID_MASIVOS';
// Colombia es UTC-5 todo el año
const bogota = (iso: string) => new Date(`${iso}-05:00`);
const TUESDAY_10AM = bogota('2026-11-24T10:00');

/**
 * Integración de masivos (Etapa 6) contra PostgreSQL y Redis reales: importador, regla de
 * verificados, STOP en plena campaña, ventanas Ley 2300 con reloj simulado, topes, errores de Meta,
 * estados por webhook firmado, respuestas a campañas y un worker BullMQ real que se reanuda solo.
 */
describe('Etapa 6 · Masivos (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let engine: CampaignEngine;
  let queue: CampaignQueue;
  let processor: WebhookProcessor;
  let redis: Redis;
  let emit: jest.SpyInstance;
  const env = { ...process.env };
  const mail = { isConfigured: jest.fn(() => true), send: jest.fn(), onModuleInit: jest.fn() };

  const clock = { current: TUESDAY_10AM, now: () => clock.current };
  const advance = (ms: number) => (clock.current = new Date(clock.current.getTime() + ms));

  let outSeq = 0;
  const reply = () => Promise.resolve({ waMessageId: `wamid.out.${++outSeq}` });
  const cloudApi = {
    isConfigured: jest.fn(() => true),
    canSyncTemplates: jest.fn(() => false),
    sendTemplate: jest.fn((to: unknown): Promise<{ waMessageId: string }> =>
      Promise.resolve({ waMessageId: `wamid.camp.${String(to).slice(-4)}.${++outSeq}` }),
    ),
    sendText: jest.fn(reply),
    sendButtons: jest.fn(reply),
    sendList: jest.fn(reply),
    markAsRead: jest.fn(() => Promise.resolve()),
    downloadMedia: jest.fn(),
    listTemplates: jest.fn(),
    getQualityRating: jest.fn((): Promise<string | null> => Promise.resolve('GREEN')),
  };

  let admin: { id: string; token: string };
  let asesor: { id: string; token: string };
  const api = () => request(app.getHttpServer());
  const as = (who: { token: string }) => ({ Authorization: `Bearer ${who.token}` });

  async function makeUser(email: string, role: Role, name: string) {
    const user = await prisma.user.create({ data: { email, role, name, passwordHash: 'x' } });
    return { id: user.id, token: await app.get(AuthService).issueAccessToken(user) };
  }

  let phoneSeq = 0;
  const nextPhone = () =>
    `57300${String(1_000_000 + ++phoneSeq)
      .slice(1)
      .padStart(7, '0')}`;
  async function contact(status: ContactConsentStatus = 'DOCUMENTED', extra: Record<string, unknown> = {}) {
    const phone = (extra.phone as string) ?? nextPhone();
    return prisma.contact.create({
      data: {
        phone,
        phoneHash: phoneHash(phone),
        name: 'Ana María Pérez',
        source: 'IMPORT',
        sourceDetail: 'Consultoría Andina',
        consentStatus: status,
        ...extra,
      },
    });
  }

  const MARKETING_BODY = 'Hola {{1}}, en JurisGlobal te acompañamos con tu caso. ¿Hablamos?';
  async function template(over: Record<string, unknown> = {}) {
    return prisma.messageTemplate.create({
      data: {
        name: 'promo_asesoria',
        language: 'es_CO',
        category: 'MARKETING',
        purpose: 'MARKETING',
        status: 'APPROVED',
        components: [],
        bodyText: MARKETING_BODY,
        footerText: 'Responde STOP para no recibir más',
        buttons: [
          { text: 'Quiero asesoría', role: 'OTHER' },
          { text: 'No recibir más', role: 'OPT_OUT' },
        ],
        variableCount: 1,
        hasOptOut: true,
        ...over,
      },
    });
  }
  const optInTemplate = () =>
    template({
      name: 'confirmacion_autorizacion',
      purpose: 'OPT_IN',
      category: 'MARKETING',
      bodyText: 'Hola {{1}}, ¿autorizas a JurisGlobal a enviarte información de sus servicios por WhatsApp?',
      footerText: null,
      buttons: [
        { text: 'Sí, acepto', role: 'OPT_IN_ACCEPT' },
        { text: 'No, gracias', role: 'OPT_OUT' },
      ],
    });

  async function launch(templateId: string, body: Record<string, unknown> = {}) {
    const res = await api()
      .post('/admin/campaigns')
      .set(as(admin))
      .send({ name: 'Campaña de noviembre', templateId, audience: { type: 'all' }, ...body })
      .expect(201);
    return res.body as { id: string; status: string; metrics: Record<string, number> };
  }

  /** Corre el motor como el worker: avanza el reloj en cada jitter y se detiene en otra espera */
  async function drive(campaignId: string, maxSteps = 60): Promise<StepResult> {
    let last: StepResult = { kind: 'done', reason: 'none' };
    for (let i = 0; i < maxSteps; i++) {
      last = await engine.step(campaignId);
      if (last.kind === 'done' || (last.reason !== 'JITTER' && last.reason !== 'YIELD')) return last;
      advance(last.ms);
    }
    return last;
  }

  const messages = (campaignId: string) =>
    prisma.campaignMessage.findMany({
      where: { campaignId },
      include: { contact: true },
      orderBy: { createdAt: 'asc' },
    });
  const sentTo = () => cloudApi.sendTemplate.mock.calls.map((c) => c[0] as string);

  // ── Webhook de Meta firmado ──
  const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  async function deliver(value: Record<string, unknown>, field = 'messages') {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field,
              value:
                field === 'messages'
                  ? { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, ...value }
                  : value,
            },
          ],
        },
      ],
    });
    await api()
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(raw))
      .send(raw)
      .expect(200);
    await processor.drain();
  }
  let inSeq = 0;
  const ts = () => String(Math.floor(Date.now() / 1000));
  const status = (id: string, value: string, errors?: unknown[]) =>
    deliver({ statuses: [{ id, status: value, timestamp: ts(), recipient_id: '57', ...(errors ? { errors } : {}) }] });
  const inbound = (from: string, extra: Record<string, unknown>) =>
    deliver({
      contacts: [{ wa_id: from, profile: { name: 'Perfil' } }],
      messages: [{ from, id: `wamid.in.${++inSeq}`, timestamp: ts(), ...extra }],
    });

  beforeAll(async () => {
    Object.assign(process.env, {
      META_APP_SECRET: SECRET,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
      GOOGLE_GENERATIVE_AI_API_KEY: '',
    });
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(WhatsAppCloudApi)
      .useValue(cloudApi)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app, loadEnv());
    await app.init();
    prisma = new PrismaClient();
    engine = app.get(CampaignEngine);
    queue = app.get(CampaignQueue);
    processor = app.get(WebhookProcessor);
    redis = app.get(REDIS);
    emit = jest.spyOn(app.get(RealtimeGateway), 'emitToPanel');
  });

  afterAll(async () => {
    await queue?.instance.obliterate({ force: true }).catch(() => undefined);
    await prisma?.$disconnect();
    await app?.close();
    process.env = env;
    resetEnvCache();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    cloudApi.getQualityRating.mockImplementation(() => Promise.resolve('GREEN'));
    cloudApi.sendTemplate.mockImplementation(() => Promise.resolve({ waMessageId: `wamid.camp.${++outSeq}` }));
    clock.current = TUESDAY_10AM;
    const settings = app.get(SettingsService);
    await settings.set('marketing.jitterMs', { min: 3000, max: 3000 }, null);
    admin = await makeUser('socio@jurisglobal.test', Role.ADMIN, 'Ronaldo Socio');
    asesor = await makeUser('asesora@jurisglobal.test', Role.ASESOR, 'Laura Asesora');
  });

  // ───────────────────────── 1. Importador ─────────────────────────
  describe('Importador de contactos (.csv y .xlsx)', () => {
    it('normaliza +57, deduplica en el archivo y contra la base, separa verificados y no verificados', async () => {
      const existingUnverified = await contact('UNVERIFIED', { phone: '573110000001', name: null });
      await contact('DOCUMENTED', { phone: '573110000002' });
      await contact('OPTED_OUT', { phone: '573110000003', optedOutAt: new Date() });
      const csv = [
        'Nombre,Teléfono,Correo,Origen,Autorización',
        'Ana Pérez,+57 300 111 2233,ana@correo.co,Consultoría Andina,Sí',
        'Luis Gómez,3001112244,,Consultoría Andina,no',
        'Ana repetida,300-111-2233,,Consultoría Andina,si',
        'Sin número,123,,Consultoría Andina,si',
        'Fijo,6014567890,,Consultoría Andina,si',
        'Existente,311 000 0001,existente@correo.co,Feria Bogotá,documentada',
        'Igual,3110000002,,Consultoría Andina,si',
        'De baja,3110000003,,Consultoría Andina,si',
      ].join('\n');
      const res = await api()
        .post('/admin/contacts/import')
        .set(as(admin))
        .field('consentNote', 'Contrato con la consultoría, cláusula 7 (autorización para JurisGlobal)')
        .attach('file', Buffer.from(`\uFEFF${csv}`, 'utf8'), 'base.csv')
        .expect(200);

      expect(res.body).toMatchObject({
        totalRows: 8,
        imported: 2,
        updated: 1,
        duplicates: 2,
        duplicatesInFile: 1,
        duplicatesExisting: 1,
        optedOutSkipped: 1,
        invalid: 2,
        verified: 2,
        unverified: 1,
      });
      expect(res.body.invalidDetails).toEqual([
        'Fila 5: el Teléfono "123" no es un celular colombiano válido',
        'Fila 6: el Teléfono "6014567890" no es un celular colombiano válido',
      ]);

      const ana = await prisma.contact.findUniqueOrThrow({ where: { phone: '573001112233' } });
      const luis = await prisma.contact.findUniqueOrThrow({ where: { phone: '573001112244' } });
      expect(ana).toMatchObject({
        consentStatus: 'DOCUMENTED',
        source: 'IMPORT',
        sourceDetail: 'Consultoría Andina',
        email: 'ana@correo.co',
      });
      expect(luis.consentStatus).toBe('UNVERIFIED');
      // El existente sin verificar sube a DOCUMENTED y se completa su nombre; nunca se reactiva una baja
      expect(await prisma.contact.findUniqueOrThrow({ where: { id: existingUnverified.id } })).toMatchObject({
        consentStatus: 'DOCUMENTED',
        name: 'Existente',
      });
      expect((await prisma.contact.findUniqueOrThrow({ where: { phone: '573110000003' } })).consentStatus).toBe(
        'OPTED_OUT',
      );
      // Soporte documental: una autorización de marketing por cada verificado, con su fila y la nota
      const consents = await prisma.consent.findMany({ where: { purpose: 'MARKETING_WHATSAPP', channel: 'IMPORT' } });
      expect(consents).toHaveLength(2);
      expect(consents.find((c) => c.contactId === ana.id)?.textSnapshot).toContain('cláusula 7');
      expect(await prisma.auditLog.count({ where: { action: 'contacts.import' } })).toBe(1);
    });

    it('lee .xlsx y rechaza archivos sin las columnas Origen y Autorización', async () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Teléfono', 'Nombre', 'Origen', 'Autorización'],
        [3205556677, 'Marta', 'Feria', 'si'],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
      const xlsx = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      const ok = await api()
        .post('/admin/contacts/import')
        .set(as(admin))
        .attach('file', xlsx, 'base.xlsx')
        .expect(200);
      expect(ok.body).toMatchObject({ imported: 1, verified: 1 });

      const bad = await api()
        .post('/admin/contacts/import')
        .set(as(admin))
        .attach('file', Buffer.from('Nombre,Telefono\nAna,3001234567\n'), 'x.csv')
        .expect(400);
      expect(bad.body.message).toMatch(/Faltan columnas obligatorias: Origen, Autorización/);
      expect(await prisma.contact.count({ where: { phone: '573001234567' } })).toBe(0);
    });

    it('solo ADMIN: el ASESOR recibe 403 en contactos, plantillas y campañas', async () => {
      await api().get('/admin/contacts').set(as(asesor)).expect(403);
      await api().post('/admin/contacts/import').set(as(asesor)).attach('file', Buffer.from('a'), 'a.csv').expect(403);
      await api().get('/admin/templates').set(as(asesor)).expect(403);
      await api().get('/admin/campaigns').set(as(asesor)).expect(403);
      await api().get('/admin/campaigns').expect(401);
    });

    it('listado con filtro por estado y búsqueda; alta y baja manual', async () => {
      await contact('DOCUMENTED');
      await contact('UNVERIFIED', { name: 'Pedro Unverified' });
      const created = await api()
        .post('/admin/contacts')
        .set(as(admin))
        .send({ phone: '+57 315 444 5566', name: 'Carla', source: 'Referido', consent: 'UNVERIFIED' })
        .expect(201);
      const list = await api().get('/admin/contacts?status=unverified').set(as(admin)).expect(200);
      expect(list.body.total).toBe(2);
      expect(list.body.counts).toEqual({ verified: 1, unverified: 2, optedOut: 0 });
      expect((await api().get('/admin/contacts?q=pedro').set(as(admin))).body.items).toHaveLength(1);
      await api()
        .post('/admin/contacts')
        .set(as(admin))
        .send({ phone: '3154445566', source: 'Referido', consent: 'UNVERIFIED' })
        .expect(409);

      await api()
        .post(`/admin/contacts/${created.body.id}/opt-out`)
        .set(as(admin))
        .send({ note: 'Llamó a pedir la baja' })
        .expect(200);
      const carla = await prisma.contact.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(carla).toMatchObject({ consentStatus: 'OPTED_OUT', optOutChannel: 'PANEL' });
      expect(await prisma.suppression.count({ where: { phoneHash: carla.phoneHash } })).toBe(1);
      // Una baja no se puede volver a agregar
      await api()
        .post('/admin/contacts')
        .set(as(admin))
        .send({ phone: '3154445566', source: 'Referido', consent: 'DOCUMENTED' })
        .expect(409);
    });
  });

  // ─────────────── 2. Verificados y STOP en plena campaña ───────────────
  describe('Regla de verificados y baja inmediata', () => {
    it('vista previa: excluye no verificados y bajas; marketing nunca llega a un no verificado', async () => {
      const a = await contact('DOCUMENTED');
      const b = await contact('CONFIRMED');
      await contact('UNVERIFIED');
      const d = await contact('OPTED_OUT', { optedOutAt: new Date() });
      await prisma.suppression.create({ data: { phoneHash: d.phoneHash, reason: 'KEYWORD' } });
      const t = await template();

      const preview = await api()
        .post('/admin/campaigns/preview')
        .set(as(admin))
        .send({ templateId: t.id, audience: { type: 'all' } })
        .expect(200);
      expect(preview.body).toMatchObject({
        kind: 'MARKETING',
        total: 4,
        recipients: 2,
        excluded: { optedOut: 1, unverified: 1, alreadyVerified: 0, total: 2 },
        problems: [],
      });
      expect(preview.body.sample.body).toBe('Hola Ana, en JurisGlobal te acompañamos con tu caso. ¿Hablamos?');

      const campaign = await launch(t.id);
      expect(campaign.status).toBe('RUNNING');
      expect(campaign.metrics).toMatchObject({ total: 4, pending: 2, skipped: 2 });
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'COMPLETED' });
      expect(sentTo().sort()).toEqual([a.phone, b.phone].sort());
      const skipped = (await messages(campaign.id)).filter((m) => m.status === 'SKIPPED').map((m) => m.skipReason);
      expect(skipped.sort()).toEqual(['NO_CONSENT', 'OPTED_OUT']);
    });

    it('la confirmación OPT_IN solo va a no verificados; un no verificado no entra a marketing aunque se seleccione', async () => {
      const verified = await contact('DOCUMENTED');
      const unverified = await contact('UNVERIFIED');
      const optIn = await optInTemplate();
      const c1 = await launch(optIn.id, { name: 'Confirmación de autorización' });
      await drive(c1.id);
      expect(sentTo()).toEqual([unverified.phone]);
      expect((await messages(c1.id)).find((m) => m.contactId === verified.id)?.skipReason).toBe('ALREADY_VERIFIED');

      cloudApi.sendTemplate.mockClear();
      const marketing = await template();
      await api()
        .post('/admin/campaigns')
        .set(as(admin))
        .send({
          name: 'Solo no verificados',
          templateId: marketing.id,
          audience: { type: 'selection', contactIds: [unverified.id] },
        })
        .expect(400);
      expect(cloudApi.sendTemplate).not.toHaveBeenCalled();
    });

    it('STOP durante la campaña: el worker lo excluye antes de enviarle (revalidación en tiempo real)', async () => {
      const first = await contact('DOCUMENTED');
      const second = await contact('DOCUMENTED');
      const third = await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);

      // Primer envío y, mientras corre el jitter, el segundo escribe STOP
      const r = await engine.step(campaign.id);
      expect(r).toEqual({ kind: 'wait', ms: 3000, reason: 'JITTER' });
      await inbound(second.phone!, { type: 'text', text: { body: 'STOP' } });
      advance(3000);
      await drive(campaign.id);

      expect(sentTo()).toEqual([first.phone, third.phone]);
      const rows = await messages(campaign.id);
      expect(rows.find((m) => m.contactId === second.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'OPTED_OUT' });
      // El wamid de Meta queda guardado en cada envío (fallo 1 del módulo Django)
      expect(rows.find((m) => m.contactId === first.id)).toMatchObject({
        status: 'SENT',
        waMessageId: expect.stringMatching(/^wamid\.camp\./),
      });
      // La plantilla queda en el Inbox de esa conversación, enlazada al destinatario
      const inboxMsg = await prisma.message.findFirstOrThrow({ where: { type: 'template' } });
      expect(inboxMsg).toMatchObject({ author: 'BOT', body: MARKETING_BODY.replace('{{1}}', 'Ana'), status: 'SENT' });
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('COMPLETED');
    });
  });

  // ─────────────── 3. Ley 2300: ventanas, domingo y festivo ───────────────
  describe('Ventanas Ley 2300 en America/Bogota (reanudación automática)', () => {
    it('sábado 15:30 → espera exacta hasta el lunes 07:00; ese lunes envía solo', async () => {
      await contact('DOCUMENTED');
      clock.current = bogota('2026-11-28T15:30');
      const campaign = await launch((await template()).id);
      const r = await engine.step(campaign.id);
      expect(r).toEqual({
        kind: 'wait',
        ms: bogota('2026-11-30T07:00').getTime() - clock.current.getTime(),
        reason: 'WINDOW',
      });
      expect(cloudApi.sendTemplate).not.toHaveBeenCalled();
      const waiting = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      expect(waiting).toMatchObject({ status: 'RUNNING', waitReason: 'WINDOW', nextRunAt: bogota('2026-11-30T07:00') });

      clock.current = bogota('2026-11-30T07:00');
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'COMPLETED' });
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(1);
    });

    it('programada para un domingo: no envía hasta el lunes 07:00', async () => {
      await contact('DOCUMENTED');
      const campaign = await launch((await template()).id, { scheduledAt: bogota('2026-11-29T10:00').toISOString() });
      expect(campaign.status).toBe('SCHEDULED');
      expect(await engine.step(campaign.id)).toMatchObject({ kind: 'wait', reason: 'SCHEDULED' });
      clock.current = bogota('2026-11-29T10:00');
      expect(await engine.step(campaign.id)).toEqual({ kind: 'wait', ms: 21 * 3600_000, reason: 'WINDOW' });
      clock.current = bogota('2026-11-30T07:00');
      await drive(campaign.id);
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(1);
      const done = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      expect(done.startedAt).toEqual(bogota('2026-11-30T07:00'));
    });

    it('festivo (martes 8-dic, Inmaculada Concepción): del lunes 19:30 salta al miércoles 07:00', async () => {
      await prisma.holiday.upsert({
        where: { date: new Date('2026-12-08') },
        create: { date: new Date('2026-12-08'), name: 'Inmaculada Concepción' },
        update: { enabled: true },
      });
      await contact('DOCUMENTED');
      clock.current = bogota('2026-12-07T19:30');
      const campaign = await launch((await template()).id);
      const r = await engine.step(campaign.id);
      expect(r).toEqual({
        kind: 'wait',
        ms: bogota('2026-12-09T07:00').getTime() - clock.current.getTime(),
        reason: 'WINDOW',
      });
    });

    it('worker BullMQ real: el trabajo se reprograma solo hasta la apertura y luego envía y termina', async () => {
      await contact('DOCUMENTED');
      clock.current = bogota('2026-11-29T10:00'); // domingo
      const campaign = await launch((await template()).id);
      const worker = new CampaignWorkerService(engine, queue);
      try {
        await worker.start();
        // El trabajo queda "delayed" hasta el lunes 07:00 (21 h), sin intervención manual
        const delayedKey = `${bullPrefix()}:${CAMPAIGN_QUEUE}:delayed`;
        let score: string | null = null;
        const start = Date.now();
        while (!score && Date.now() - start < 10_000) {
          score = await redis.zscore(delayedKey, campaign.id);
          if (!score) await new Promise((r) => setTimeout(r, 100));
        }
        expect(score).not.toBeNull();
        const runAt = Math.floor(Number(score) / 0x1000);
        expect(Math.abs(runAt - (Date.now() + 21 * 3600_000))).toBeLessThan(15_000);
        expect(cloudApi.sendTemplate).not.toHaveBeenCalled();

        // Llega el lunes 07:00: BullMQ lo despierta (aquí se adelanta) y el worker envía y completa
        clock.current = bogota('2026-11-30T07:00');
        await (await queue.instance.getJob(campaign.id))!.promote();
        let finished = false;
        const t0 = Date.now();
        while (!finished && Date.now() - t0 < 15_000) {
          finished = (await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status === 'COMPLETED';
          if (!finished) await new Promise((r) => setTimeout(r, 200));
        }
        expect(finished).toBe(true);
        expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(1);
      } finally {
        await worker.onModuleDestroy();
      }
    });
  });

  // ─────────────── 4. Topes ───────────────
  describe('Topes por contacto (1/día, 2/semana) y límite global diario', () => {
    async function priorSends(contactId: string, phone: string, dates: Date[]) {
      const t = await template({ name: 'campana_anterior' });
      const old = await prisma.campaign.create({
        data: { name: 'Anterior', templateId: t.id, variableMapping: {}, status: 'COMPLETED' },
      });
      for (const sentAt of dates)
        await prisma.campaignMessage.create({
          data: {
            campaignId: old.id,
            contactId,
            phone,
            variables: [],
            status: 'DELIVERED',
            sentAt,
            waMessageId: `wamid.old.${sentAt.getTime()}`,
          },
        });
      return old;
    }

    it('difiere al siguiente día hábil al contacto con tope diario o semanal; los demás salen', async () => {
      const capDay = await contact('DOCUMENTED');
      const capWeek = await contact('DOCUMENTED');
      const free = await contact('DOCUMENTED');
      await priorSends(capDay.id, capDay.phone!, [bogota('2026-11-24T08:00')]);
      const t1 = await template({ name: 'semana_1' });
      const t2 = await template({ name: 'semana_2' });
      for (const [t, d] of [
        [t1, bogota('2026-11-19T10:00')],
        [t2, bogota('2026-11-21T09:00')],
      ] as const) {
        const c = await prisma.campaign.create({
          data: { name: 'Previa', templateId: t.id, variableMapping: {}, status: 'COMPLETED' },
        });
        await prisma.campaignMessage.create({
          data: {
            campaignId: c.id,
            contactId: capWeek.id,
            phone: capWeek.phone!,
            variables: [],
            status: 'READ',
            sentAt: d,
            waMessageId: `wamid.w.${d.getTime()}`,
          },
        });
      }
      const t = await template();
      const preview = await api()
        .post('/admin/campaigns/preview')
        .set(as(admin))
        .send({ templateId: t.id, audience: { type: 'all' } })
        .expect(200);
      expect(preview.body).toMatchObject({ recipients: 3, frequencyCapped: 2 });

      const campaign = await launch(t.id);
      const r = await drive(campaign.id);
      expect(sentTo()).toEqual([free.phone]);
      // El próximo en liberarse es el de tope diario: miércoles 07:00
      expect(r).toEqual({
        kind: 'wait',
        ms: bogota('2026-11-25T07:00').getTime() - clock.current.getTime(),
        reason: 'FREQUENCY_CAP',
      });
      const rows = await messages(campaign.id);
      expect(rows.find((m) => m.contactId === capDay.id)?.notBefore).toEqual(bogota('2026-11-25T07:00'));
      // Semana móvil: el envío del jueves 19 sale de la ventana el jueves 26 a las 10:00
      expect(rows.find((m) => m.contactId === capWeek.id)?.notBefore).toEqual(
        new Date(bogota('2026-11-26T10:00').getTime() + 1000),
      );

      clock.current = bogota('2026-11-25T07:00');
      const r2 = await drive(campaign.id);
      expect(sentTo()).toEqual([free.phone, capDay.phone]);
      expect(r2).toMatchObject({ kind: 'wait', reason: 'FREQUENCY_CAP' });
      clock.current = new Date(bogota('2026-11-26T10:00').getTime() + 1000);
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'COMPLETED' });
      expect(sentTo()).toEqual([free.phone, capDay.phone, capWeek.phone]);
    });

    it('límite global diario: al llegar al cupo sigue al día hábil siguiente a las 07:00, sin duplicados', async () => {
      await app.get(SettingsService).set('marketing.dailyGlobalLimit', 2, null);
      for (let i = 0; i < 4; i++) await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      const r = await drive(campaign.id);
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(2);
      expect(r).toEqual({
        kind: 'wait',
        ms: bogota('2026-11-25T07:00').getTime() - clock.current.getTime(),
        reason: 'DAILY_LIMIT',
      });
      clock.current = bogota('2026-11-25T07:00');
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'COMPLETED' });
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(4);
      expect(new Set(sentTo()).size).toBe(4);
    });
  });

  // ─────────────── 5. Errores de Meta y métricas por webhook ───────────────
  describe('Errores de Meta y métricas en tiempo real', () => {
    it('131047 no aborta la campaña; 131050 da de baja al contacto; los estados actualizan las métricas en orden', async () => {
      const ok = await contact('DOCUMENTED');
      const unreachable = await contact('DOCUMENTED');
      const blocked = await contact('DOCUMENTED');
      cloudApi.sendTemplate.mockImplementation((to: unknown) => {
        if (to === unreachable.phone) return Promise.reject(new WhatsAppApiError('Re-engagement message', 400, 131047));
        if (to === blocked.phone) return Promise.reject(new WhatsAppApiError('Experiment', 400, 131050));
        return Promise.resolve({ waMessageId: 'wamid.camp.ok' });
      });
      const campaign = await launch((await template()).id);
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'COMPLETED' });

      const rows = await messages(campaign.id);
      expect(rows.find((m) => m.contactId === unreachable.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 131047,
        errorCategory: 'RECIPIENT',
      });
      expect(rows.find((m) => m.contactId === blocked.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 131050,
        errorCategory: 'OPT_OUT',
      });
      expect(rows.find((m) => m.contactId === ok.id)).toMatchObject({ status: 'SENT', waMessageId: 'wamid.camp.ok' });
      const b = await prisma.contact.findUniqueOrThrow({ where: { id: blocked.id } });
      expect(b).toMatchObject({ consentStatus: 'OPTED_OUT', optOutChannel: 'META_131050' });
      expect(await prisma.suppression.findUnique({ where: { phoneHash: b.phoneHash } })).toMatchObject({
        reason: 'META_131050',
      });
      expect(await prisma.consent.count({ where: { contactId: b.id, granted: false } })).toBe(1);

      // Estados de Meta por el webhook firmado: delivered → read; un delivered tardío no pisa el read
      emit.mockClear();
      await status('wamid.camp.ok', 'delivered');
      await status('wamid.camp.ok', 'read');
      await status('wamid.camp.ok', 'delivered');
      expect(emit).toHaveBeenCalledWith('campaign:progress', { campaignId: campaign.id });
      const detail = await api().get(`/admin/campaigns/${campaign.id}`).set(as(admin)).expect(200);
      expect(detail.body.metrics).toMatchObject({
        total: 3,
        pending: 0,
        sent: 1,
        delivered: 1,
        read: 1,
        failed: 2,
        optedOut: 1,
      });
      expect(detail.body.topErrors.map((e: { code: number }) => e.code).sort()).toEqual([131047, 131050]);
      expect((await prisma.message.findFirstOrThrow({ where: { waMessageId: 'wamid.camp.ok' } })).status).toBe('READ');
    });

    it('un failed 131050 que llega por el webhook de estados también da de baja', async () => {
      const c = await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      await drive(campaign.id);
      const sent = (await messages(campaign.id))[0];
      await status(sent.waMessageId!, 'failed', [{ code: 131050, title: 'User stopped marketing messages' }]);
      expect(await prisma.campaignMessage.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({
        status: 'FAILED',
        errorCode: 131050,
        errorCategory: 'OPT_OUT',
        optedOutAt: expect.any(Date),
      });
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe('OPTED_OUT');
    });

    it('plantilla pausada por Meta (132015): pausa la campaña, el mensaje vuelve a la cola y Reanudar sigue', async () => {
      await contact('DOCUMENTED');
      await contact('DOCUMENTED');
      cloudApi.sendTemplate.mockRejectedValueOnce(new WhatsAppApiError('Template paused', 400, 132015));
      const campaign = await launch((await template()).id);
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'PAUSED:TEMPLATE_ERROR:132015' });
      const paused = await api().get(`/admin/campaigns/${campaign.id}`).set(as(admin)).expect(200);
      expect(paused.body).toMatchObject({ status: 'PAUSED', pausedReason: 'TEMPLATE_ERROR:132015' });
      expect(paused.body.metrics).toMatchObject({ pending: 2, failed: 0 });

      await api().post(`/admin/campaigns/${campaign.id}/resume`).set(as(admin)).expect(200);
      expect(await queue.instance.getJob(campaign.id)).toBeTruthy();
      expect(await drive(campaign.id)).toEqual({ kind: 'done', reason: 'COMPLETED' });
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(3);
    });

    it('lanzar con 2FA activo exige Sudo Mode (acción sensible)', async () => {
      await contact('DOCUMENTED');
      const t = await template();
      await prisma.user.update({ where: { id: admin.id }, data: { isTwoFactorEnabled: true } });
      const res = await api()
        .post('/admin/campaigns')
        .set(as(admin))
        .send({ name: 'Con 2FA', templateId: t.id, audience: { type: 'all' } })
        .expect(403);
      expect(res.body).toMatchObject({ message: 'SUDO_REQUIRED' });
      expect(await prisma.campaign.count()).toBe(0);
    });

    it('calidad RED en Graph (quality_rating): pausa TODAS las campañas activas y el panel lo informa', async () => {
      await contact('DOCUMENTED');
      const t = await template();
      const c1 = await launch(t.id, { name: 'Primera' });
      const c2 = await launch(t.id, { name: 'Segunda' });
      cloudApi.getQualityRating.mockResolvedValue('RED');
      expect(await engine.step(c1.id)).toEqual({ kind: 'done', reason: 'PAUSED:QUALITY_RED' });
      expect(cloudApi.sendTemplate).not.toHaveBeenCalled();
      for (const id of [c1.id, c2.id])
        expect(await prisma.campaign.findUniqueOrThrow({ where: { id } })).toMatchObject({
          status: 'PAUSED',
          pausedReason: 'QUALITY_RED',
        });
      const list = await api().get('/admin/campaigns').set(as(admin)).expect(200);
      expect(list.body.quality).toMatchObject({ rating: 'RED', source: 'GRAPH' });
      expect(emit).toHaveBeenCalledWith('whatsapp:quality', { rating: 'RED' });

      // Reanudar vuelve a consultar Graph: si sigue en RED, se pausa otra vez
      await api().post(`/admin/campaigns/${c1.id}/resume`).set(as(admin)).expect(200);
      expect(await engine.step(c1.id)).toEqual({ kind: 'done', reason: 'PAUSED:QUALITY_RED' });
      cloudApi.getQualityRating.mockResolvedValue('GREEN');
      await api().post(`/admin/campaigns/${c1.id}/resume`).set(as(admin)).expect(200);
      expect(await engine.step(c1.id)).toMatchObject({ kind: 'wait', reason: 'JITTER' });
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(1);
    });

    it('webhook phone_number_quality_update (FLAGGED) pausa las campañas activas al instante', async () => {
      await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      await deliver(
        { display_phone_number: '573000000000', event: 'FLAGGED', current_limit: 'TIER_1K' },
        'phone_number_quality_update',
      );
      expect(await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({
        status: 'PAUSED',
        pausedReason: 'QUALITY_RED',
      });
      expect(await engine.step(campaign.id)).toEqual({ kind: 'done', reason: 'INACTIVE' });
    });

    it('Pausar, Reanudar y Cancelar desde el panel (con auditoría)', async () => {
      for (let i = 0; i < 3; i++) await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      await engine.step(campaign.id);
      await api().post(`/admin/campaigns/${campaign.id}/pause`).set(as(admin)).expect(200);
      expect(await engine.step(campaign.id)).toEqual({ kind: 'done', reason: 'INACTIVE' });
      await api().post(`/admin/campaigns/${campaign.id}/pause`).set(as(admin)).expect(409);
      await api().post(`/admin/campaigns/${campaign.id}/resume`).set(as(admin)).expect(200);
      advance(3000);
      await engine.step(campaign.id);
      const cancelled = await api().post(`/admin/campaigns/${campaign.id}/cancel`).set(as(admin)).expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        metrics: { sent: 2, skipped: 1 },
        skipReasons: { CANCELLED: 1 },
      });
      expect(cloudApi.sendTemplate).toHaveBeenCalledTimes(2);
      expect(
        await prisma.auditLog.count({
          where: { action: { in: ['campaign.launch', 'campaign.pause', 'campaign.resume', 'campaign.cancel'] } },
        }),
      ).toBe(4);
    });
  });

  // ─────────────── 6. Respuestas a campañas → chatbot ───────────────
  describe('Respuestas a una campaña', () => {
    it('una respuesta escrita marca repliedAt y entra al flujo guiado del bot', async () => {
      const c = await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      await drive(campaign.id);
      const wamid = (await messages(campaign.id))[0].waMessageId!;
      await inbound(c.phone!, { type: 'text', text: { body: 'Hola, quiero información' }, context: { id: wamid } });
      expect((await messages(campaign.id))[0].repliedAt).toBeInstanceOf(Date);
      expect(cloudApi.sendButtons).toHaveBeenCalledWith(
        c.phone,
        expect.stringContaining('¿Nos autorizas?'),
        expect.any(Array),
      );
      expect((await prisma.conversation.findUniqueOrThrow({ where: { waId: c.phone! } })).flowState).toBe(
        'ASK_CONSENT',
      );
    });

    it('el botón de baja de la plantilla da de baja (TEMPLATE_BUTTON) y cuenta en la métrica de bajas', async () => {
      const c = await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      await drive(campaign.id);
      const wamid = (await messages(campaign.id))[0].waMessageId!;
      await inbound(c.phone!, {
        type: 'button',
        button: { text: 'No recibir más', payload: 'No recibir más' },
        context: { id: wamid },
      });
      expect(await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
        consentStatus: 'OPTED_OUT',
        optOutChannel: 'TEMPLATE_BUTTON',
      });
      expect(cloudApi.sendText).toHaveBeenCalledWith(c.phone, expect.stringContaining('no volverás a recibir'));
      const detail = await api().get(`/admin/campaigns/${campaign.id}`).set(as(admin)).expect(200);
      expect(detail.body.metrics).toMatchObject({ optedOut: 1, replied: 1 });
    });

    it('«Sí, acepto» en la confirmación OPT_IN deja al contacto CONFIRMED (apto para marketing) con su evidencia', async () => {
      const c = await contact('UNVERIFIED');
      const campaign = await launch((await optInTemplate()).id);
      await drive(campaign.id);
      const wamid = (await messages(campaign.id))[0].waMessageId!;
      await inbound(c.phone!, {
        type: 'button',
        button: { text: 'Sí, acepto', payload: 'Sí, acepto' },
        context: { id: wamid },
      });
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe('CONFIRMED');
      const consent = await prisma.consent.findFirstOrThrow({
        where: { contactId: c.id, purpose: 'MARKETING_WHATSAPP', granted: true },
      });
      expect(consent.evidence).toMatchObject({ contextWamid: wamid, campaignId: campaign.id });
      // Ahora sí entra a una campaña de marketing
      const preview = await api()
        .post('/admin/campaigns/preview')
        .set(as(admin))
        .send({ templateId: (await template()).id, audience: { type: 'all' } })
        .expect(200);
      expect(preview.body.recipients).toBe(1);
    });
  });

  // ─────────────── Envío de prueba / unitario ───────────────
  describe('Envío de prueba / unitario (1 a 1)', () => {
    const SUNDAY_10AM = bogota('2026-11-29T10:00');
    const simple = () =>
      template({
        name: 'prueba_envio_masivo',
        bodyText: 'Prueba de envío de JurisGlobal.',
        footerText: null,
        buttons: [],
        variableCount: 0,
        hasOptOut: false,
      });
    const testSend = (body: Record<string, unknown>, who = admin) =>
      api().post('/admin/campaigns/test-send').set(as(who)).send(body);

    it('plantilla aprobada sin variables ni opción de baja: envía, queda en el Inbox y en la bitácora', async () => {
      const t = await simple();
      const res = await testSend({ templateId: t.id, phone: '+57 300 111 2233' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'SENT',
        phone: '+57 300 111 2233',
        body: 'Prueba de envío de JurisGlobal.',
        insideWindow: true,
        windowBypassed: false,
      });
      expect(cloudApi.sendTemplate).toHaveBeenCalledWith('573001112233', 'prueba_envio_masivo', 'es_CO', []);
      const msg = await prisma.message.findFirstOrThrow({ where: { waMessageId: res.body.waMessageId } });
      expect(msg).toMatchObject({ direction: 'OUTBOUND', type: 'template', sentById: admin.id });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'campaign.test_send' } });
      expect(log.data).toMatchObject({ template: 'prueba_envio_masivo', skipWindow: false, windowBypassed: false });
      // No crea campañas ni cuenta en los topes de masivos
      expect(await prisma.campaignMessage.count()).toBe(0);
    });

    it('reemplaza las variables y exige todas', async () => {
      const t = await template();
      const missing = await testSend({ templateId: t.id, phone: '3001112233' }).expect(400);
      expect(missing.body.message).toMatch(/\{\{1\}\}/);
      const ok = await testSend({ templateId: t.id, phone: '3001112233', variables: ['Marta'] }).expect(200);
      expect(ok.body.body).toBe('Hola Marta, en JurisGlobal te acompañamos con tu caso. ¿Hablamos?');
      expect(cloudApi.sendTemplate).toHaveBeenCalledWith('573001112233', 'promo_asesoria', 'es_CO', ['Marta']);
    });

    it('domingo: sin la casilla respeta la Ley 2300; con «Enviar inmediatamente» envía y lo registra', async () => {
      const t = await simple();
      clock.current = SUNDAY_10AM;
      const blocked = await testSend({ templateId: t.id, phone: '3001112233' }).expect(409);
      expect(blocked.body.message).toMatch(/Ley 2300/);
      expect(blocked.body.message).toMatch(/lunes/);
      expect(cloudApi.sendTemplate).not.toHaveBeenCalled();

      const res = await testSend({ templateId: t.id, phone: '3001112233', skipWindow: true }).expect(200);
      expect(res.body).toMatchObject({ status: 'SENT', insideWindow: false, windowBypassed: true });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'campaign.test_send' } });
      expect(log.data).toMatchObject({ skipWindow: true, insideWindow: false, windowBypassed: true });
      // La configuración legal no cambió: una campaña normal lanzada ese domingo sigue esperando al lunes
      expect(await prisma.sendWindow.count({ where: { dayOfWeek: 0, enabled: true } })).toBe(0);
      await contact('DOCUMENTED');
      const campaign = await launch((await template()).id);
      cloudApi.sendTemplate.mockClear();
      expect(await engine.step(campaign.id)).toEqual({ kind: 'wait', ms: 21 * 3600_000, reason: 'WINDOW' });
      expect(cloudApi.sendTemplate).not.toHaveBeenCalled();
    });

    it('festivo: también exige la casilla', async () => {
      await prisma.holiday.upsert({
        where: { date: new Date('2026-12-08') },
        create: { date: new Date('2026-12-08'), name: 'Inmaculada Concepción' },
        update: { enabled: true },
      });
      clock.current = bogota('2026-12-08T10:00');
      const t = await simple();
      await testSend({ templateId: t.id, phone: '3001112233' }).expect(409);
      await testSend({ templateId: t.id, phone: '3001112233', skipWindow: true }).expect(200);
    });

    it('la baja se respeta siempre; plantilla no aprobada, celular inválido y ASESOR se rechazan', async () => {
      const t = await simple();
      await contact('OPTED_OUT', { phone: '573004445566', optedOutAt: new Date() });
      const res = await testSend({ templateId: t.id, phone: '300 444 5566', skipWindow: true }).expect(409);
      expect(res.body.message).toMatch(/baja/);
      const pending = await template({ name: 'pendiente', status: 'PENDING' });
      await testSend({ templateId: pending.id, phone: '3001112233' }).expect(400);
      await testSend({ templateId: t.id, phone: '6015551234' }).expect(400);
      await testSend({ templateId: t.id, phone: '3001112233' }, asesor).expect(403);
      expect(cloudApi.sendTemplate).not.toHaveBeenCalled();
    });

    it('error 131050 de Meta en la prueba: informa y registra la baja', async () => {
      const t = await simple();
      cloudApi.sendTemplate.mockImplementationOnce(() =>
        Promise.reject(new WhatsAppApiError('marketing bloqueado', 400, 131050)),
      );
      const res = await testSend({ templateId: t.id, phone: '3007778899' }).expect(502);
      expect(res.body.message).toMatch(/131050/);
      expect(await prisma.suppression.count({ where: { phoneHash: phoneHash('573007778899') } })).toBe(1);
    });
  });

  // ─────────────── Vista previa del archivo y plantilla Excel ───────────────
  describe('Plantilla Excel y vista previa de la primera fila', () => {
    // Respuesta binaria (.xlsx) como Buffer
    const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      const stream = res as unknown as NodeJS.ReadableStream;
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    it('la plantilla .xlsx trae las columnas exactas y se puede importar tal cual; la vista previa no guarda nada', async () => {
      const file = await api()
        .get('/admin/contacts/import-template')
        .set(as(admin))
        .buffer(true)
        .parse(binary)
        .expect(200)
        .expect('Content-Type', /spreadsheetml/);
      const book = XLSX.read(file.body as Buffer, { type: 'buffer' });
      expect(book.SheetNames).toEqual(['Contactos', 'Instrucciones']);
      const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Contactos, { header: 1, raw: false });
      expect(rows[0]).toEqual(['Telefono', 'Nombre', 'Origen', 'Autorizacion', 'Correo', 'Etiquetas']);

      const preview = await api()
        .post('/admin/contacts/import/preview')
        .set(as(admin))
        .attach('file', file.body as Buffer, 'plantilla.xlsx')
        .expect(200);
      expect(preview.body).toMatchObject({
        error: null,
        validRows: 2,
        verified: 1,
        unverified: 1,
        columns: { phone: 'Telefono', name: 'Nombre', source: 'Origen', consent: 'Autorizacion' },
        firstRow: {
          Telefono: '300 123 4567',
          Nombre: 'Ana María Pérez',
          Origen: 'Consultoría Andina',
          Autorizacion: 'Sí',
        },
        firstContact: {
          phone: '+57 300 123 4567',
          name: 'Ana María Pérez',
          consent: 'DOCUMENTED',
          source: 'Consultoría Andina',
        },
        sources: ['Consultoría Andina', 'Feria Barranquilla 2026'],
      });
      expect(await prisma.contact.count()).toBe(0);

      const imported = await api()
        .post('/admin/contacts/import')
        .set(as(admin))
        .attach('file', file.body as Buffer, 'plantilla.xlsx')
        .expect(200);
      expect(imported.body).toMatchObject({ imported: 2, verified: 1, unverified: 1, invalid: 0 });
    });

    it('vista previa de un archivo sin columnas obligatorias: muestra las cabeceras y el error', async () => {
      const res = await api()
        .post('/admin/contacts/import/preview')
        .set(as(admin))
        .attach('file', Buffer.from('Nombre,Celular\nAna,3001234567\n'), 'x.csv')
        .expect(200);
      expect(res.body.error).toMatch(/Faltan columnas obligatorias: Origen, Autorización/);
      expect(res.body).toMatchObject({
        headers: ['Nombre', 'Celular'],
        firstRow: { Nombre: 'Ana', Celular: '3001234567' },
      });
      await api().get('/admin/contacts/import-template').set(as(asesor)).expect(403);
      await api()
        .post('/admin/contacts/import/preview')
        .set(as(asesor))
        .attach('file', Buffer.from('a'), 'a.csv')
        .expect(403);
    });
  });

  // ─────────────── Plantillas ───────────────
  describe('Plantillas (metadatos)', () => {
    it('alta manual con variables; sin opción de baja solo hay un aviso y la campaña se puede lanzar', async () => {
      const created = await api()
        .post('/admin/templates')
        .set(as(admin))
        .send({
          name: 'novedades_diciembre',
          language: 'es_CO',
          category: 'MARKETING',
          purpose: 'MARKETING',
          bodyText: 'Hola {{1}}, tenemos novedades para tu caso de {{2}}.',
          buttons: [{ text: 'Me interesa', role: 'OTHER' }],
        })
        .expect(201);
      expect(created.body).toMatchObject({ variableCount: 2, hasOptOut: false, status: 'APPROVED' });
      expect(created.body.problems).toEqual([]);
      expect(created.body.warnings[0]).toMatch(/STOP/);
      await contact('DOCUMENTED');
      const preview = await api()
        .post('/admin/campaigns/preview')
        .set(as(admin))
        .send({
          templateId: created.body.id,
          audience: { type: 'all' },
          variableMapping: { '2': { type: 'literal', value: 'tránsito' } },
        })
        .expect(200);
      expect(preview.body).toMatchObject({ problems: [], recipients: 1, sampleContact: { name: 'Ana María Pérez' } });
      expect(preview.body.warnings[0]).toMatch(/STOP/);
      const launched = await api()
        .post('/admin/campaigns')
        .set(as(admin))
        .send({
          name: 'Sin baja',
          templateId: created.body.id,
          audience: { type: 'all' },
          variableMapping: { '2': { type: 'literal', value: 'tránsito' } },
          dryRun: true,
        })
        .expect(201);
      await api().post(`/admin/campaigns/${launched.body.id}/cancel`).set(as(admin)).expect(200);

      const fixed = await api()
        .patch(`/admin/templates/${created.body.id}`)
        .set(as(admin))
        .send({
          ...created.body,
          id: undefined,
          metaId: undefined,
          variableCount: undefined,
          hasOptOut: undefined,
          source: undefined,
          lastSyncedAt: undefined,
          updatedAt: undefined,
          campaigns: undefined,
          problems: undefined,
          warnings: undefined,
          headerText: undefined,
          status: 'APPROVED',
          footerText: 'Responde STOP para no recibir más',
        })
        .expect(200);
      expect(fixed.body).toMatchObject({ hasOptOut: true, problems: [], warnings: [] });
      await api()
        .post('/admin/templates')
        .set(as(admin))
        .send({
          name: 'Con Mayúsculas',
          language: 'es',
          category: 'MARKETING',
          purpose: 'MARKETING',
          bodyText: 'Hola a todos los clientes',
        })
        .expect(400);
      await api().post('/admin/templates/sync').set(as(admin)).expect(503);
    });
  });

  it('simulación (dry-run) de 2.000 contactos con reloj acelerado: siempre en ventana, ≤ límite diario, sin duplicados', async () => {
    await app.get(SettingsService).set('marketing.dailyGlobalLimit', 100, null);
    await app.get(SettingsService).set('marketing.jitterMs', { min: 120_000, max: 300_000 }, null);
    const rows = Array.from({ length: 2000 }, (_, i) => {
      const phone = `5731${String(i).padStart(8, '0')}`;
      return {
        phone,
        phoneHash: phoneHash(phone),
        source: 'IMPORT' as const,
        sourceDetail: 'Base 2.000',
        consentStatus: 'DOCUMENTED' as const,
      };
    });
    await prisma.contact.createMany({ data: rows });
    clock.current = bogota('2026-12-04T18:00'); // viernes: cierra a las 19:00, luego sábado corto y festivos de diciembre
    const campaign = await launch((await template()).id, { dryRun: true });

    let result: StepResult = { kind: 'wait', ms: 0, reason: 'YIELD' };
    for (let i = 0; i < 6000 && result.kind === 'wait'; i++) {
      result = await engine.step(campaign.id);
      if (result.kind === 'wait') advance(result.ms);
    }
    expect(result).toEqual({ kind: 'done', reason: 'COMPLETED' });
    expect(cloudApi.sendTemplate).not.toHaveBeenCalled(); // simulación: nunca llama a Meta

    const sent = await prisma.campaignMessage.findMany({
      where: { campaignId: campaign.id },
      select: { status: true, sentAt: true, contactId: true },
    });
    expect(sent.every((m) => m.status === 'SENT')).toBe(true);
    expect(new Set(sent.map((m) => m.contactId)).size).toBe(2000);
    const windows = await prisma.sendWindow.findMany();
    const holidays = new Set(
      (await prisma.holiday.findMany({ where: { enabled: true } })).map((h) => h.date.toISOString().slice(0, 10)),
    );
    expect(sent.filter((m) => !isWithinSendWindow(windows, holidays, m.sentAt!))).toHaveLength(0);
    const perDay = new Map<string, number>();
    for (const m of sent) perDay.set(localDateKey(m.sentAt!), (perDay.get(localDateKey(m.sentAt!)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(100);
    expect([...perDay.keys()].some((d) => d === '2026-12-08' || d === '2026-12-25')).toBe(false);
    expect([...perDay.keys()].some((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0)).toBe(false);
    // Simulación: no cuenta para los topes reales ni toca el Inbox
    expect(await prisma.message.count({ where: { type: 'template' } })).toBe(0);
  }, 300_000);

  it('límite por IP de POST /leads vive en Redis (no en la memoria del proceso)', async () => {
    const prefix = loadEnv().REDIS_KEY_PREFIX;
    for (let i = 0; i < loadEnv().LEADS_RATE_LIMIT; i++)
      await api()
        .post('/leads')
        .set('X-Forwarded-For', '10.77.0.1')
        .send({
          fullName: 'Ana María Pérez',
          phone: `30099900${String(i).padStart(2, '0')}`,
          email: 'ana@correo.co',
          motivo: 'Tránsito',
          origin: 'web',
          privacyAndTerms: true,
          contactAndDataProcessing: true,
        });
    await api()
      .post('/leads')
      .set('X-Forwarded-For', '10.77.0.1')
      .send({
        fullName: 'Ana María Pérez',
        phone: '3009990099',
        email: 'ana@correo.co',
        motivo: 'Tránsito',
        origin: 'web',
        privacyAndTerms: true,
        contactAndDataProcessing: true,
      })
      .expect(429);
    const keys = await redis.keys(`${prefix}throttle:*`);
    expect(keys.length).toBeGreaterThan(0);
  });
});
