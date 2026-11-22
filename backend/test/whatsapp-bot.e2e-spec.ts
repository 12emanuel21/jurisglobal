import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { promises as fs } from 'fs';
import request from 'supertest';
import { generateObject, generateText } from 'ai';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv, resetEnvCache } from '../src/config/env';
import { phoneHash } from '../src/common/crypto';
import { MailService } from '../src/mail/mail.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { WhatsAppCloudApi } from '../src/whatsapp/cloud-api.client';
import { WebhookProcessor } from '../src/whatsapp/webhook.processor';
import { chatMediaPath } from '../src/whatsapp/media';
import { resetDatabase, waitFor } from './helpers';
import { MOTIVOS } from '../src/scripts/seed';

// Gemini simulado: se ve exactamente qué prompt y qué pregunta le llegan
jest.mock('ai', () => ({ ...jest.requireActual('ai'), generateObject: jest.fn(), generateText: jest.fn() }));
const generateObjectMock = generateObject as jest.Mock;
const generateTextMock = generateText as jest.Mock;

const SECRET = 'app-secret-e2e';
const PHONE_ID = 'PHONE_ID_E2E';
const PHONE = '573001112233';

interface Sent {
  kind: 'text' | 'buttons' | 'list';
  to: string;
  body: string;
  options: Array<{ id: string; title: string }>;
  waMessageId: string;
}

/**
 * Integración del chatbot (Etapa 4): webhooks firmados con HMAC contra POST /webhooks/whatsapp,
 * PostgreSQL real (base _test), LeadsService real y Meta, Gemini y SMTP simulados.
 */
// URL pública configurada (PUBLIC_BASE_URL): localhost en desarrollo, el dominio real en producción
const site = () => loadEnv().PUBLIC_BASE_URL.replace(/\/+$/, '');

describe('Etapa 4 · Chatbot de WhatsApp por webhook firmado (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let processor: WebhookProcessor;
  let emit: jest.SpyInstance;
  const env = { ...process.env };
  const mail = { isConfigured: jest.fn(() => true), send: jest.fn(), onModuleInit: jest.fn() };

  let sent: Sent[] = [];
  let outSeq = 0;
  const record = (kind: Sent['kind'], to: string, body: string, options: Sent['options'] = []) => {
    const waMessageId = `wamid.out.${++outSeq}`;
    sent.push({ kind, to, body, options, waMessageId });
    return Promise.resolve({ waMessageId });
  };
  const cloudApi = {
    isConfigured: jest.fn(() => true),
    sendText: jest.fn((to: string, body: string) => record('text', to, body)),
    sendButtons: jest.fn((to: string, body: string, buttons: Sent['options']) => record('buttons', to, body, buttons)),
    sendList: jest.fn((to: string, body: string, _button: string, rows: Sent['options']) =>
      record('list', to, body, rows),
    ),
    markAsRead: jest.fn(() => Promise.resolve()),
    downloadMedia: jest.fn(),
  };

  let inSeq = 0;
  const nowSeconds = () => String(Math.floor(Date.now() / 1000));
  const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  /** Entrega un cambio de Meta firmado y espera a que se procese (el webhook responde 200 antes) */
  async function deliver(value: Record<string, unknown>, secret = SECRET) {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_E2E',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '573000000000', phone_number_id: PHONE_ID },
                ...value,
              },
            },
          ],
        },
      ],
    });
    const res = await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(raw, secret))
      .send(raw);
    await processor.drain();
    return res;
  }
  const message = (from: string, extra: Record<string, unknown>, id = `wamid.in.${++inSeq}`) =>
    deliver({
      contacts: [{ wa_id: from, profile: { name: 'Perfil de WhatsApp' } }],
      messages: [{ from, id, timestamp: nowSeconds(), ...extra }],
    });
  const say = (body: string, from = PHONE) => message(from, { type: 'text', text: { body } });
  const tap = (id: string, title: string, from = PHONE) =>
    message(from, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
  const pick = (id: string, title: string, from = PHONE) =>
    message(from, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });

  const conversation = (waId = PHONE) => prisma.conversation.findUniqueOrThrow({ where: { waId } });
  const last = () => sent[sent.length - 1];
  const motivoId = async (name: string) => (await prisma.motivo.findUniqueOrThrow({ where: { name } })).id;

  /** Hasta el paso indicado con datos válidos */
  async function reach(step: 'ASK_NAME' | 'ASK_EMAIL' | 'ASK_MOTIVO', from = PHONE, name = 'Ana María Pérez') {
    await say('Hola', from);
    await tap('consent:yes', 'Acepto', from);
    if (step === 'ASK_NAME') return;
    await say(name, from);
    if (step === 'ASK_EMAIL') return;
    await say('ana@correo.co', from);
  }

  const webLead = (phone = '300 111 2233') =>
    request(app.getHttpServer())
      .post('/leads')
      .set('X-Forwarded-For', `10.9.0.${++inSeq % 250}`)
      .send({
        fullName: 'Ana María Pérez',
        phone,
        email: 'ana@correo.co',
        motivo: 'Familia y tránsito',
        origin: 'web',
        privacyAndTerms: true,
        contactAndDataProcessing: true,
      })
      .expect(201);

  const highDemand = () =>
    Object.assign(new Error('The model is overloaded due to high demand.'), {
      name: 'AI_APICallError',
      statusCode: 503,
    });

  beforeAll(async () => {
    Object.assign(process.env, {
      META_APP_SECRET: SECRET,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
      GOOGLE_GENERATIVE_AI_API_KEY: 'clave-de-prueba',
      LEAD_NOTIFICATION_EMAIL: 'equipo@jurisglobal.test',
    });
    resetEnvCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(WhatsAppCloudApi)
      .useValue(cloudApi)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app, loadEnv());
    await app.init();
    processor = app.get(WebhookProcessor);
    emit = jest.spyOn(app.get(RealtimeGateway), 'emitToPanel');
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    process.env = env;
    resetEnvCache();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sent = [];
    jest.clearAllMocks();
    mail.send.mockResolvedValue(undefined);
    generateObjectMock.mockReset();
    generateTextMock.mockReset();
  });

  afterEach(async () => {
    // Adjuntos que guardaron las pruebas de notas de voz y PDF
    const files = await prisma.message.findMany({ where: { mediaFile: { not: null } }, select: { mediaFile: true } });
    for (const { mediaFile } of files) {
      const file = chatMediaPath(mediaFile!);
      if (file) await fs.unlink(file).catch(() => undefined);
    }
  });

  it('1 · flujo completo: saludo → Acepto → nombre → correo → motivo → lead WHATSAPP, Consent, correo y cierre', async () => {
    await say('Hola');
    expect(last()).toMatchObject({ kind: 'buttons', to: PHONE });
    expect(last().body).toContain('JurisGlobal');
    expect(last().body).toContain('llamada o correo');
    expect(last().body).toContain('¿Nos autorizas?');
    expect(last().body).toContain(`Aviso de Privacidad: ${site()}/legal/privacidad`);
    expect(last().options).toEqual([
      { id: 'consent:yes', title: 'Acepto' },
      { id: 'consent:no', title: 'No acepto' },
    ]);
    expect((await conversation()).flowState).toBe('ASK_CONSENT');

    await tap('consent:yes', 'Acepto');
    const consent = await prisma.consent.findFirstOrThrow({ where: { phoneHash: phoneHash(PHONE) } });
    expect(consent).toMatchObject({
      purpose: 'CONTACT_AND_DATA_PROCESSING',
      granted: true,
      channel: 'WHATSAPP',
      phone: PHONE,
      leadId: null,
      textVersion: 'consent.whatsapp.contact@1',
    });
    expect(consent.textSnapshot).toContain('¿Nos autorizas?');
    expect(consent.evidence).toMatchObject({ buttonId: 'consent:yes', wamid: expect.stringMatching(/^wamid\.in\./) });
    expect(last().body).toContain('nombre completo');
    expect((await conversation()).flowState).toBe('ASK_NAME');

    await say('Ana María Pérez');
    expect(last().body).toContain('Gracias, Ana');
    expect(last().body).toContain('correo electrónico');

    await say('Ana@Correo.co');
    expect(last().kind).toBe('list'); // 7 motivos activos (6 áreas + Otro) -> lista interactiva
    expect(last().options.map((o) => o.title)).toEqual(MOTIVOS);
    expect(last().body).toContain('6. Familia y tránsito');

    await pick(`motivo:${await motivoId('Familia y tránsito')}`, 'Familia y tránsito');
    const lead = await prisma.lead.findUniqueOrThrow({ where: { phone: PHONE }, include: { motivo: true } });
    expect(lead).toMatchObject({
      fullName: 'Ana María Pérez',
      email: 'ana@correo.co',
      origin: 'WHATSAPP',
      lastOrigin: 'WHATSAPP',
      submissionCount: 1,
    });
    expect(lead.motivo.name).toBe('Familia y tránsito');
    // El Consent del botón «Acepto» queda enlazado al lead (sin duplicarse)
    const consents = await prisma.consent.findMany({ where: { phoneHash: phoneHash(PHONE) } });
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ id: consent.id, leadId: lead.id, contactId: lead.contactId });
    expect((await conversation()).contactId).toBe(lead.contactId);

    const closing = last().body;
    expect(closing).toContain('• *Nombre:* Ana María Pérez');
    expect(closing).toContain('• *Teléfono:* +57 300 111 2233');
    expect(closing).toContain('• *Correo:* ana@correo.co');
    expect(closing).toContain('• *Motivo:* Familia y tránsito');
    expect(closing).toContain(
      'Gracias, hemos registrado tus datos. Un asesor de JurisGlobal se comunicará contigo pronto por llamada o correo.',
    );
    expect((await conversation()).flowState).toBe('DONE');
    expect(emit).toHaveBeenCalledWith('lead:new', { leadId: lead.id, isNew: true });
    await waitFor(() => mail.send.mock.calls.length === 1);
    expect(JSON.stringify(mail.send.mock.calls[0])).toContain('Ana María Pérez');

    // Cada respuesta del bot quedó en el Inbox con su wamid para los estados de entrega
    const botMessages = await prisma.message.findMany({ where: { author: 'BOT' } });
    expect(botMessages).toHaveLength(5);
    expect(botMessages.every((m) => m.status === 'SENT' && m.waMessageId?.startsWith('wamid.out.'))).toBe(true);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it('1b · con 3 motivos o menos usa botones y acepta el número escrito', async () => {
    await prisma.motivo.updateMany({
      where: { name: { notIn: ['Insolvencia y deudas', 'Reestructuración', 'Familia y tránsito'] } },
      data: { isActive: false },
    });
    await reach('ASK_MOTIVO');
    expect(last().kind).toBe('buttons');
    expect(last().options.map((o) => o.title)).toEqual([
      'Insolvencia y deudas',
      'Reestructuración',
      'Familia y tránsito',
    ]);

    await say('1');
    const lead = await prisma.lead.findUniqueOrThrow({ where: { phone: PHONE }, include: { motivo: true } });
    expect(lead.motivo.name).toBe('Insolvencia y deudas');
  });

  it('2 · «No acepto»: sin lead, comparte los canales institucionales y vuelve a empezar', async () => {
    await prisma.setting.update({ where: { key: 'company.email' }, data: { value: 'contacto@jurisglobal.test' } });
    await prisma.setting.update({ where: { key: 'company.phone' }, data: { value: '300 123 4567' } });
    await say('Hola');
    await tap('consent:no', 'No acepto');

    expect(last().kind).toBe('text');
    expect(last().body).toContain('Sin tu autorización no podemos registrar tus datos');
    expect(last().body).toContain(`Web: ${site()}`);
    expect(last().body).toContain('Correo: contacto@jurisglobal.test');
    expect(last().body).toContain('Teléfono: 300 123 4567');
    expect(await prisma.lead.count()).toBe(0);
    const refusal = await prisma.consent.findFirstOrThrow({ where: { phoneHash: phoneHash(PHONE) } });
    expect(refusal).toMatchObject({ granted: false, phone: null, leadId: null, channel: 'WHATSAPP' });
    expect(await conversation()).toMatchObject({ flowState: 'IDLE', flowData: {} });

    await say('Hola de nuevo');
    expect(last().kind).toBe('buttons');
    expect((await conversation()).flowState).toBe('ASK_CONSENT');
  });

  it('3 · correo inválido: lo pide de nuevo sin perder el avance', async () => {
    await reach('ASK_EMAIL');
    await say('ana@@correo');
    expect(last().body).toContain('no parece válido');
    const conv = await conversation();
    expect(conv.flowState).toBe('ASK_EMAIL');
    expect(conv.flowData).toMatchObject({ fullName: 'Ana María Pérez' });

    await say('mi correo es ana@correo.co');
    expect((await conversation()).flowState).toBe('ASK_MOTIVO');
    expect((await conversation()).flowData).toMatchObject({ fullName: 'Ana María Pérez', email: 'ana@correo.co' });
  });

  describe('4 · pregunta fuera de flujo (Gemini simulado)', () => {
    it('interruptor apagado: el prompt no trae precio ni "gratis" y se retoma el paso pendiente', async () => {
      generateObjectMock.mockResolvedValue({ object: { reply: 'Un asesor te confirmará las condiciones.' } });
      await reach('ASK_NAME');
      await say('¿Cuánto cuesta la consulta?');

      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      const args = generateObjectMock.mock.calls[0][0];
      expect(args.system).toContain('un asesor le confirmará las condiciones');
      expect(args.system).toContain('Nunca digas que es gratis');
      expect(args.system).not.toMatch(/\$\d/);
      expect(args.system).toContain('su nombre completo');
      // Minimización: a Gemini solo le llega la pregunta
      expect(args.messages).toEqual([{ role: 'user', content: '¿Cuánto cuesta la consulta?' }]);

      expect(last().body).toBe('Un asesor te confirmará las condiciones.\n\n¿Cuál es tu *nombre completo*?');
      const conv = await conversation();
      expect(conv.flowState).toBe('ASK_NAME');
      expect(conv.flowData).not.toHaveProperty('fullName');
    });

    it('interruptor encendido: inyecta "$100.000 COP" y retoma el correo', async () => {
      await prisma.setting.update({ where: { key: 'showConsultationPrice' }, data: { value: true } });
      await prisma.setting.update({ where: { key: 'consultationPrice' }, data: { value: 100000 } });
      generateObjectMock.mockResolvedValue({
        object: { reply: 'La asesoría inicial tiene un valor de $100.000 COP.' },
      });
      await reach('ASK_EMAIL');
      await say('¿Cuánto vale la asesoría?');

      expect(generateObjectMock.mock.calls[0][0].system).toContain(
        'La asesoría inicial tiene un valor de $100.000 COP',
      );
      expect(last().body).toBe(
        'La asesoría inicial tiene un valor de $100.000 COP.\n\n¿Cuál es tu *correo electrónico*?',
      );
      expect((await conversation()).flowState).toBe('ASK_EMAIL');
    });

    it('Gemini saturado o lento: respuesta fija con el precio real y sin bloquear el flujo', async () => {
      await prisma.setting.update({ where: { key: 'showConsultationPrice' }, data: { value: true } });
      await prisma.setting.update({ where: { key: 'consultationPrice' }, data: { value: 100000 } });
      generateObjectMock.mockRejectedValue(highDemand());
      await reach('ASK_NAME');
      await say('¿cuánto cobran?');

      expect(generateObjectMock).toHaveBeenCalledTimes(3); // cadena de modelos de respaldo
      expect(last().body).toBe('La asesoría inicial tiene un valor de $100.000 COP.\n\n¿Cuál es tu *nombre completo*?');
      expect((await conversation()).flowState).toBe('ASK_NAME');
    });

    it('si la IA dice "gratis" (interruptor apagado) se descarta y va la respuesta fija', async () => {
      generateObjectMock.mockResolvedValue({ object: { reply: '¡La consulta es gratis! Te esperamos.' } });
      await reach('ASK_MOTIVO');
      await say('¿Cuánto cuesta?');

      expect(last().body).toContain('Un asesor te confirmará las condiciones de la asesoría inicial');
      expect(last().body).not.toMatch(/gratis/i);
      expect(last().kind).toBe('list'); // la repregunta del motivo vuelve con su lista
      expect((await conversation()).flowState).toBe('ASK_MOTIVO');
    });
  });

  it('5 · STOP en medio del flujo: baja inmediata, revocación, nota en el lead y silencio hasta INICIO', async () => {
    await webLead();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { phone: PHONE } });
    await reach('ASK_EMAIL');
    await say('NO QUIERO MÁS MENSAJES');

    expect(last().body).toContain('no volverás a recibir mensajes automáticos');
    const contact = await prisma.contact.findUniqueOrThrow({ where: { phone: PHONE } });
    expect(contact).toMatchObject({ consentStatus: 'OPTED_OUT', optOutChannel: 'KEYWORD' });
    expect(contact.optedOutAt).toBeInstanceOf(Date);
    expect(await prisma.suppression.findUnique({ where: { phoneHash: phoneHash(PHONE) } })).toMatchObject({
      reason: 'KEYWORD',
    });
    const revocation = await prisma.consent.findFirstOrThrow({ where: { purpose: 'MARKETING_WHATSAPP' } });
    expect(revocation).toMatchObject({ granted: false, channel: 'WHATSAPP', leadId: lead.id, contactId: contact.id });
    expect(revocation.textSnapshot).toContain('NO QUIERO MÁS MENSAJES');
    const note = await prisma.leadNote.findFirstOrThrow({ where: { leadId: lead.id, body: { contains: 'Baja' } } });
    expect(note.body).toContain('No recibirá más mensajes automáticos');
    expect(await conversation()).toMatchObject({ flowState: 'OPTED_OUT', flowData: {} });
    expect(await prisma.message.count({ where: { author: 'SYSTEM', body: '[SYSTEM_OPT_OUT]' } })).toBe(1);

    // Tras la baja el bot calla (el mensaje sigue llegando al Inbox)
    const before = sent.length;
    await say('Hola');
    expect(sent).toHaveLength(before);
    expect(await prisma.message.count({ where: { author: 'CONTACT', body: 'Hola' } })).toBe(2);

    // Solo un INICIO explícito vuelve a empezar (la baja de mensajes masivos se mantiene)
    await say('INICIO');
    expect(last().kind).toBe('buttons');
    expect((await conversation()).flowState).toBe('ASK_CONSENT');
    expect((await prisma.contact.findUniqueOrThrow({ where: { phone: PHONE } })).consentStatus).toBe('OPTED_OUT');
  });

  it('6 · conversación pausada desde el Inbox: guarda y notifica, pero el bot no responde', async () => {
    await say('Hola');
    const conv = await conversation();
    await prisma.conversation.update({ where: { id: conv.id }, data: { botPausedAt: new Date() } });
    const before = sent.length;
    emit.mockClear();

    await say('¿Cuánto cuesta la consulta?');
    expect(sent).toHaveLength(before);
    expect(generateObjectMock).not.toHaveBeenCalled();
    const inbound = await prisma.message.findFirstOrThrow({ where: { body: '¿Cuánto cuesta la consulta?' } });
    expect(emit).toHaveBeenCalledWith('message:new', { conversationId: conv.id, messageId: inbound.id });
    expect((await conversation()).flowState).toBe('ASK_CONSENT');

    // Con el bot pausado, la baja se registra igual, sin respuesta automática
    await say('STOP');
    expect(sent).toHaveLength(before);
    expect((await prisma.contact.findUniqueOrThrow({ where: { phone: PHONE } })).consentStatus).toBe('OPTED_OUT');
  });

  it('7 · deduplicación: el teléfono ya llegó por la web -> un solo lead, nota automática y nuevo aviso', async () => {
    await webLead();
    await waitFor(() => mail.send.mock.calls.length === 1);
    await reach('ASK_MOTIVO', PHONE, 'Ana Pérez');
    await pick(`motivo:${await motivoId('Insolvencia y deudas')}`, 'Insolvencia y deudas');

    const leads = await prisma.lead.findMany({ include: { notes: true, consents: true } });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      fullName: 'Ana María Pérez',
      origin: 'WEB',
      lastOrigin: 'WHATSAPP',
      submissionCount: 2,
    });
    expect(leads[0].notes).toHaveLength(1);
    expect(leads[0].notes[0].body).toContain('Recontacto automático por WhatsApp (envío #2)');
    expect(leads[0].notes[0].body).toContain('Nombre: «Ana Pérez»');
    expect(leads[0].notes[0].body).toContain('Motivo: «Insolvencia y deudas» (registrado: «Familia y tránsito»)');
    // 2 autorizaciones de la web + la del botón «Acepto»
    expect(leads[0].consents.map((c) => c.channel).sort()).toEqual(['WEB', 'WEB', 'WHATSAPP']);
    expect(emit).toHaveBeenCalledWith('lead:updated', { leadId: leads[0].id, isNew: false });
    await waitFor(() => mail.send.mock.calls.length === 2);
    expect(last().body).toContain('Gracias, hemos registrado tus datos');
  });

  it('8 · estados de entrega: sent → delivered → read (monótono) y failed con su código', async () => {
    await say('Hola');
    const outbound = last().waMessageId;
    const status = (id: string, value: string, extra: Record<string, unknown> = {}) =>
      deliver({ statuses: [{ id, status: value, timestamp: nowSeconds(), recipient_id: PHONE, ...extra }] });

    await status(outbound, 'sent');
    await status(outbound, 'delivered');
    expect((await prisma.message.findUniqueOrThrow({ where: { waMessageId: outbound } })).status).toBe('DELIVERED');
    await status(outbound, 'read');
    await status(outbound, 'delivered'); // tardío: no pisa "read"
    const read = await prisma.message.findUniqueOrThrow({ where: { waMessageId: outbound } });
    expect(read.status).toBe('READ');
    expect(emit).toHaveBeenCalledWith('message:status', {
      conversationId: read.conversationId,
      messageId: read.id,
      status: 'READ',
    });

    await tap('consent:yes', 'Acepto');
    const second = last().waMessageId;
    await status(second, 'failed', {
      errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'Más de 24 h' } }],
    });
    const failed = await prisma.message.findUniqueOrThrow({ where: { waMessageId: second } });
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 131047 });
    expect(failed.errorDetail).toContain('Re-engagement message');

    await expect(status('wamid.desconocido', 'read')).resolves.toBeDefined(); // sin error
  });

  describe('seguridad y robustez del webhook', () => {
    it('firma inválida: 403 y no se procesa nada', async () => {
      const res = await message(PHONE, { type: 'text', text: { body: 'Hola' } }).catch(() => null);
      expect(res?.status).toBe(200);
      sent = [];
      const forged = await deliver(
        {
          messages: [
            { from: '573009990000', id: 'wamid.forged', timestamp: nowSeconds(), type: 'text', text: { body: 'x' } },
          ],
        },
        'otro-secreto',
      );
      expect(forged.status).toBe(403);
      expect(await prisma.conversation.count({ where: { waId: '573009990000' } })).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it('el mismo wamid reenviado por Meta se procesa una sola vez', async () => {
      await message(PHONE, { type: 'text', text: { body: 'Hola' } }, 'wamid.repetido');
      await message(PHONE, { type: 'text', text: { body: 'Hola' } }, 'wamid.repetido');
      expect(sent).toHaveLength(1);
      expect(await prisma.message.count({ where: { waMessageId: 'wamid.repetido' } })).toBe(1);
    });

    it('más de 24 h sin mensajes: reinicio limpio desde el saludo', async () => {
      await reach('ASK_EMAIL');
      const conv = await conversation();
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      });
      await say('hola');
      expect(last().kind).toBe('buttons');
      expect(await conversation()).toMatchObject({ flowState: 'ASK_CONSENT', flowData: {} });
    });

    it('"reiniciar" en medio del flujo vuelve al saludo', async () => {
      await reach('ASK_EMAIL');
      await say('reiniciar');
      expect(last().body).toContain('¿Nos autorizas?');
      expect((await conversation()).flowState).toBe('ASK_CONSENT');
    });
  });

  describe('notas de voz y adjuntos', () => {
    const audio = () =>
      message(PHONE, { type: 'audio', audio: { id: 'MEDIA_AUDIO', mime_type: 'audio/ogg; codecs=opus' } });

    beforeEach(() => {
      cloudApi.downloadMedia.mockResolvedValue({
        buffer: Buffer.from('OggS-nota-de-voz-de-prueba'),
        mime: 'audio/ogg',
      });
    });

    it('nota de voz con transcripción útil: se usa como dato (nombre)', async () => {
      await reach('ASK_NAME');
      generateTextMock.mockResolvedValue({ text: 'Me llamo Carlos Gómez' });
      await audio();
      const conv = await conversation();
      expect(conv).toMatchObject({
        flowState: 'ASK_EMAIL',
        flowData: expect.objectContaining({ fullName: 'Carlos Gómez' }),
      });
      expect(await prisma.message.findFirst({ where: { mediaKind: 'AUDIO' } })).toMatchObject({
        body: 'Me llamo Carlos Gómez',
        mediaFile: expect.stringMatching(/\.ogg$/),
      });
    });

    it('nota de voz sin un correo claro: pide escribirlo para evitar errores', async () => {
      await reach('ASK_EMAIL');
      generateTextMock.mockResolvedValue({ text: 'ana arroba correo punto co' });
      await audio();
      expect(last().body).toContain('¿me lo escribes, por favor?');
      expect((await conversation()).flowState).toBe('ASK_EMAIL');
    });

    it('PDF o imagen: queda en la conversación para el Inbox y se pide el dato pendiente', async () => {
      await reach('ASK_EMAIL');
      cloudApi.downloadMedia.mockResolvedValue({
        buffer: Buffer.from('%PDF-1.4 comparendo de prueba'),
        mime: 'application/pdf',
      });
      await message(PHONE, {
        type: 'document',
        document: { id: 'MEDIA_PDF', mime_type: 'application/pdf', filename: 'comparendo.pdf' },
      });
      const stored = await prisma.message.findFirstOrThrow({ where: { mediaKind: 'DOCUMENT' } });
      expect(stored).toMatchObject({ mediaName: 'comparendo.pdf', mediaFile: expect.stringMatching(/\.pdf$/) });
      expect(last().body).toContain('Recibimos tu archivo');
      expect(last().body).toContain('¿Cuál es tu *correo electrónico*?');
      expect((await conversation()).flowState).toBe('ASK_EMAIL');
    });
  });

  it('WhatsApp extranjero: pide un número de Colombia para el lead', async () => {
    const foreign = '14155550123';
    await reach('ASK_MOTIVO', foreign);
    expect(last().body).toContain('número colombiano');
    expect((await conversation(foreign)).flowState).toBe('ASK_PHONE');
    await say('300 999 8877', foreign);
    expect((await conversation(foreign)).flowState).toBe('ASK_MOTIVO');
    await say('Reestructuración', foreign);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { phone: '573009998877' } });
    expect(lead.origin).toBe('WHATSAPP');
    // El Consent del botón (otro número) se conserva; el lead lleva el suyo propio
    expect(await prisma.consent.count({ where: { leadId: lead.id } })).toBe(1);
  });
});
