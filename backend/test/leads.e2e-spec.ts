import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { phoneHash } from '../src/common/crypto';
import { MailService } from '../src/mail/mail.service';
import { LeadsService } from '../src/leads/leads.service';
import { resetDatabase, waitFor } from './helpers';

/**
 * Integración: GET /public/config y POST /leads contra PostgreSQL real (base _test), con la misma
 * configuración HTTP que producción y el SMTP simulado.
 */
describe('Etapa 2 · Configuración pública y API de leads (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const mail = { isConfigured: jest.fn(() => true), send: jest.fn(), onModuleInit: jest.fn() };
  let ipCounter = 0;
  /** IP distinta por petición: el límite por IP no interfiere entre pruebas */
  const freshIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const validLead = {
    fullName: 'Ana María Pérez',
    phone: '300 123 4567',
    email: 'ana@correo.co',
    motivo: 'Tránsito',
    origin: 'web',
    privacyAndTerms: true,
    contactAndDataProcessing: true,
  };
  const post = (body: Record<string, unknown>, ip = freshIp()) =>
    request(app.getHttpServer()).post('/leads').set('X-Forwarded-For', ip).set('User-Agent', 'jest-e2e').send(body);

  beforeAll(async () => {
    process.env.LEAD_NOTIFICATION_EMAIL = 'equipo@jurisglobal.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app, loadEnv());
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.send.mockReset().mockResolvedValue(undefined);
  });

  describe('GET /public/config', () => {
    it('motivos activos ordenados, precio oculto con el interruptor apagado, enlaces y textos legales', async () => {
      const res = await request(app.getHttpServer()).get('/public/config').expect(200);
      expect(res.body.motivos.map((m: { name: string }) => m.name)).toEqual(['Tránsito', 'Cartera', 'Deudas', 'Otro']);
      expect(res.body.showConsultationPrice).toBe(false);
      expect(res.body.consultationPrice).toBeNull();
      expect(res.body.legal).toEqual({ privacy: '/privacidad', terms: '/terminos', cookies: '/cookies' });
      expect(res.body.consents.privacyAndTerms).toMatchObject({
        version: 1,
        text: expect.stringContaining('JurisGlobal'),
      });
      expect(res.body.consents.contactAndDataProcessing.text).toContain('JurisGlobal');
      expect(res.headers['cache-control']).toBe('public, max-age=60');
    });

    it('con el interruptor encendido publica el valor; los motivos inactivos no aparecen', async () => {
      await prisma.setting.update({ where: { key: 'showConsultationPrice' }, data: { value: true } });
      await prisma.setting.update({ where: { key: 'consultationPrice' }, data: { value: 120000 } });
      await prisma.motivo.update({ where: { name: 'Cartera' }, data: { isActive: false } });
      const res = await request(app.getHttpServer()).get('/public/config').expect(200);
      expect(res.body).toMatchObject({ showConsultationPrice: true, consultationPrice: 120000, currency: 'COP' });
      expect(res.body.motivos.map((m: { name: string }) => m.name)).toEqual(['Tránsito', 'Deudas', 'Otro']);
    });
  });

  describe('POST /leads', () => {
    it('crea el lead (estado NEW, +57), su contacto y dos consentimientos con el texto exacto; avisa por correo', async () => {
      const res = await post(validLead).expect(201);
      expect(res.body).toEqual({ ok: true, message: expect.stringContaining('Un asesor de JurisGlobal') });
      expect(JSON.stringify(res.body)).not.toMatch(/leadId|isNew/); // no revela si el número ya existía

      const lead = await prisma.lead.findUniqueOrThrow({
        where: { phone: '573001234567' },
        include: { motivo: true, consents: true, contact: true },
      });
      expect(lead).toMatchObject({
        fullName: 'Ana María Pérez',
        email: 'ana@correo.co',
        status: 'NEW',
        origin: 'WEB',
        lastOrigin: 'WEB',
        submissionCount: 1,
      });
      expect(lead.motivo.name).toBe('Tránsito');
      expect(lead.phoneHash).toBe(phoneHash('573001234567'));
      expect(lead.contact).toMatchObject({ phone: '573001234567', source: 'WEB', consentStatus: 'UNVERIFIED' });

      const privacyText = (await prisma.setting.findUniqueOrThrow({ where: { key: 'consent.web.privacy' } })).value as {
        text: string;
      };
      expect(lead.consents.map((c) => c.purpose).sort()).toEqual([
        'CONTACT_AND_DATA_PROCESSING',
        'PRIVACY_TERMS_COOKIES',
      ]);
      const privacy = lead.consents.find((c) => c.purpose === 'PRIVACY_TERMS_COOKIES')!;
      expect(privacy).toMatchObject({
        granted: true,
        channel: 'WEB',
        textVersion: 'consent.web.privacy@1',
        textSnapshot: privacyText.text,
        phoneHash: lead.phoneHash,
      });
      expect(privacy.evidence).toMatchObject({ ip: expect.stringMatching(/^10\.1\./), userAgent: 'jest-e2e' });

      await waitFor(() => mail.send.mock.calls.length === 1);
      const sent = mail.send.mock.calls[0][0];
      expect(sent.to).toEqual(['equipo@jurisglobal.test']);
      expect(sent.subject).toBe('Nuevo lead · Ana María Pérez · Tránsito (Formulario web)');
      expect(sent.html).toContain(`/panel/leads/${lead.id}`);
      expect(sent.html).toContain('https://wa.me/573001234567');
    });

    it.each(['+57 300 123 4567', '300-123-4567', '57 3001234567', '(300) 123 4567'])(
      'normaliza %s al mismo lead',
      async (phone) => {
        await post({ ...validLead, phone }).expect(201);
        await post({ ...validLead, phone: '3001234567' }).expect(201);
        expect(await prisma.lead.count()).toBe(1);
        expect((await prisma.lead.findFirstOrThrow()).phone).toBe('573001234567');
      },
    );

    it('deduplica por teléfono: no duplica, no sobrescribe, deja nota, suma consentimientos y avisa como recontacto', async () => {
      await post(validLead).expect(201);
      await post({ ...validLead, email: 'otro@correo.co', motivo: 'deudas' }).expect(201);

      const leads = await prisma.lead.findMany({ include: { notes: true, consents: true, motivo: true } });
      expect(leads).toHaveLength(1);
      const [lead] = leads;
      expect(lead).toMatchObject({ email: 'ana@correo.co', submissionCount: 2 });
      expect(lead.motivo.name).toBe('Tránsito');
      expect(lead.consents).toHaveLength(4);
      expect(lead.notes).toHaveLength(1);
      expect(lead.notes[0].body).toContain('Recontacto automático por el formulario web (envío #2)');
      expect(lead.notes[0].body).toContain('Correo: «otro@correo.co»');
      expect(lead.notes[0].body).toContain('Motivo: «Deudas» (registrado: «Tránsito»)');

      await waitFor(() => mail.send.mock.calls.length === 2);
      expect(mail.send.mock.calls[1][0].subject).toMatch(/^Recontacto \(envío #2\)/);
    });

    it.each([
      ['teléfono extranjero', { phone: '+1 305 555 0100' }],
      ['teléfono incompleto', { phone: '300123' }],
      ['correo inválido', { email: 'ana@' }],
      ['motivo inexistente', { motivo: 'Penal' }],
      ['sin autorización de privacidad', { privacyAndTerms: false }],
      ['sin autorización de contacto', { contactAndDataProcessing: false }],
      ['nombre con números', { fullName: 'Ana 123' }],
      ['campo no permitido', { role: 'ADMIN' }],
    ])('rechaza (400): %s', async (_label, patch) => {
      await post({ ...validLead, ...patch }).expect(400);
      expect(await prisma.lead.count()).toBe(0);
      expect(await prisma.consent.count()).toBe(0);
    });

    it('rechaza un motivo inactivo', async () => {
      await prisma.motivo.update({ where: { name: 'Tránsito' }, data: { isActive: false } });
      await post(validLead).expect(400);
    });

    it('acepta el motivo por id', async () => {
      const otro = await prisma.motivo.findUniqueOrThrow({ where: { name: 'Otro' } });
      await post({ ...validLead, motivo: otro.id }).expect(201);
      expect((await prisma.lead.findFirstOrThrow()).motivoId).toBe(otro.id);
    });

    it('origin "whatsapp" no se acepta desde Internet (403)', async () => {
      await post({ ...validLead, origin: 'whatsapp' }).expect(403);
      expect(await prisma.lead.count()).toBe(0);
    });

    it('honeypot: responde igual pero no guarda nada', async () => {
      await post({ ...validLead, website: 'http://spam.example' }).expect(201);
      expect(await prisma.lead.count()).toBe(0);
    });

    it('un fallo del SMTP no impide guardar el lead', async () => {
      mail.send.mockRejectedValue(new Error('SMTP caído'));
      await post(validLead).expect(201);
      expect(await prisma.lead.count()).toBe(1);
      await waitFor(() => mail.send.mock.calls.length >= 1);
    });

    it('límite por IP: al superar LEADS_RATE_LIMIT por minuto responde 429', async () => {
      const ip = '10.9.9.9';
      const limit = loadEnv().LEADS_RATE_LIMIT;
      for (let i = 0; i < limit; i++)
        await post({ ...validLead, phone: `30012345${String(i).padStart(2, '0')}` }, ip).expect(201);
      await post(validLead, ip).expect(429);
    });
  });

  describe('LeadsService.submit (canal interno del chatbot)', () => {
    it('WhatsApp: origen WHATSAPP, una autorización con el texto del bot y el wamid; enlaza la conversación', async () => {
      const conversation = await prisma.conversation.create({ data: { waId: '573109876543' } });
      const result = await app.get(LeadsService).submit({
        fullName: 'Luis Gómez',
        phone: '573109876543',
        email: 'luis@correo.co',
        motivo: 'Cartera',
        channel: 'WHATSAPP',
        consents: { contactAndDataProcessing: true },
        evidence: { wamid: 'wamid.ABC', buttonId: 'consent_yes' },
      });
      expect(result).toMatchObject({ isNew: true, phone: '+573109876543', submissionCount: 1 });

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { consents: true } });
      expect(lead.origin).toBe('WHATSAPP');
      expect(lead.consents).toHaveLength(1);
      expect(lead.consents[0]).toMatchObject({
        channel: 'WHATSAPP',
        purpose: 'CONTACT_AND_DATA_PROCESSING',
        textVersion: 'consent.whatsapp.contact@1',
        evidence: { wamid: 'wamid.ABC', buttonId: 'consent_yes' },
      });
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).contactId).toBe(
        lead.contactId,
      );
    });

    it('un lead web que luego escribe por WhatsApp es un recontacto del mismo lead', async () => {
      await post(validLead).expect(201);
      const result = await app.get(LeadsService).submit({
        ...validLead,
        phone: '573001234567',
        channel: 'WHATSAPP',
        consents: { contactAndDataProcessing: true },
      });
      expect(result).toMatchObject({ isNew: false, submissionCount: 2 });
      expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ origin: 'WEB', lastOrigin: 'WHATSAPP' });
    });
  });
});
