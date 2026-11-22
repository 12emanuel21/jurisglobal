import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient, Role } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { phoneHash } from '../src/common/crypto';
import { MailService } from '../src/mail/mail.service';
import { AuthService } from '../src/auth/auth.service';
import { LeadsService } from '../src/leads/leads.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { CHAT_MEDIA_ROOT } from '../src/whatsapp/media';
import { resetDatabase } from './helpers';
import { MOTIVOS } from '../src/scripts/seed';

/**
 * Integración del panel (Etapa 5): leads, exportación, anonimización Ley 1581, configuración y
 * usuarios contra PostgreSQL real, con tokens reales de ADMIN y ASESOR (Bearer) y SMTP simulado.
 */
describe('Etapa 5 · Panel de administración (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let leads: LeadsService;
  let emit: jest.SpyInstance;
  const mail = { isConfigured: jest.fn(() => true), send: jest.fn(), onModuleInit: jest.fn() };

  let admin: { id: string; token: string };
  let asesor: { id: string; token: string };

  const api = () => request(app.getHttpServer());
  const as = (who: { token: string }) => ({ Authorization: `Bearer ${who.token}` });

  async function makeUser(email: string, role: Role, name: string) {
    const user = await prisma.user.create({ data: { email, role, name, passwordHash: 'x' } });
    return { id: user.id, token: await app.get(AuthService).issueAccessToken(user) };
  }

  const submit = (over: Partial<Parameters<LeadsService['submit']>[0]> = {}) =>
    leads.submit({
      fullName: 'Ana María Pérez',
      phone: '3001234567',
      email: 'ana@correo.co',
      motivo: 'Familia y tránsito',
      channel: 'WEB',
      consents: { privacyAndTerms: true, contactAndDataProcessing: true },
      evidence: { ip: '10.0.0.1', userAgent: 'jest' },
      ...over,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app, loadEnv());
    await app.init();
    prisma = new PrismaClient();
    leads = app.get(LeadsService);
    emit = jest.spyOn(app.get(RealtimeGateway), 'emitToPanel');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    mail.send.mockResolvedValue(undefined);
    admin = await makeUser('socio@jurisglobal.test', Role.ADMIN, 'Ronaldo Socio');
    asesor = await makeUser('asesora@jurisglobal.test', Role.ASESOR, 'Laura Asesora');
  });

  describe('Leads: listado, filtros y paginación', () => {
    beforeEach(async () => {
      await submit();
      await submit({
        fullName: 'Carlos Gómez',
        phone: '3109998877',
        email: 'carlos@gmail.com',
        motivo: 'Insolvencia y deudas',
      });
      await submit({
        fullName: 'Luz Dary Rojas',
        phone: '6051234567',
        email: 'luz@empresa.co',
        motivo: 'Reestructuración',
        channel: 'WHATSAPP',
        consents: { contactAndDataProcessing: true },
      });
      await prisma.lead.update({ where: { phone: '573109998877' }, data: { status: 'CONTACTED' } });
    });

    it('sin sesión 401; ASESOR y ADMIN ven el listado con teléfono +57 y motivo', async () => {
      await api().get('/admin/leads').expect(401);
      const res = await api().get('/admin/leads').set(as(asesor)).expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 25, pages: 1 });
      const luz = res.body.items.find((l: { fullName: string }) => l.fullName === 'Luz Dary Rojas');
      expect(luz).toMatchObject({
        phone: '+576051234567',
        origin: 'WHATSAPP',
        motivo: { name: 'Reestructuración' },
        status: 'NEW',
      });
      await api().get('/admin/leads').set(as(admin)).expect(200);
    });

    it('filtros por estado (en español), motivo, origen, búsqueda y fechas', async () => {
      const names = async (query: Record<string, string>) =>
        (await api().get('/admin/leads').query(query).set(as(asesor)).expect(200)).body.items
          .map((l: { fullName: string }) => l.fullName)
          .sort();

      expect(await names({ status: 'contactado' })).toEqual(['Carlos Gómez']);
      expect(await names({ status: 'nuevo' })).toEqual(['Ana María Pérez', 'Luz Dary Rojas']);
      const cartera = await prisma.motivo.findUniqueOrThrow({ where: { name: 'Insolvencia y deudas' } });
      expect(await names({ motivoId: cartera.id })).toEqual(['Carlos Gómez']);
      expect(await names({ origin: 'whatsapp' })).toEqual(['Luz Dary Rojas']);
      expect(await names({ origin: 'web' })).toEqual(['Ana María Pérez', 'Carlos Gómez']);
      expect(await names({ q: 'gómez' })).toEqual(['Carlos Gómez']);
      expect(await names({ q: '310 999' })).toEqual(['Carlos Gómez']);
      expect(await names({ q: 'empresa.co' })).toEqual(['Luz Dary Rojas']);

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
      expect(await names({ from: today, to: today })).toHaveLength(3);
      expect(await names({ to: '2020-01-01' })).toEqual([]);
      await api().get('/admin/leads').query({ status: 'perdido' }).set(as(asesor)).expect(400);
      await api().get('/admin/leads').query({ from: '22/11/2026' }).set(as(asesor)).expect(400);
    });

    it('paginación del servidor y tarjetas por estado', async () => {
      const page2 = await api().get('/admin/leads').query({ page: 2, pageSize: 2 }).set(as(asesor)).expect(200);
      expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2, pages: 2 });
      expect(page2.body.items).toHaveLength(1);
      await api().get('/admin/leads').query({ pageSize: 500 }).set(as(asesor)).expect(400);

      const summary = await api().get('/admin/leads/summary').set(as(asesor)).expect(200);
      expect(summary.body).toEqual({ byStatus: { NEW: 2, CONTACTED: 1, SCHEDULED: 0, CLOSED: 0 }, total: 3 });
    });
  });

  describe('Leads: detalle, estado, responsable y notas', () => {
    it('detalle con consentimientos; el ASESOR cambia estado, asigna y anota (con bitácora y Socket.io)', async () => {
      const { leadId } = await submit();
      await submit({ fullName: 'Ana Pérez' }); // recontacto: nota automática

      const detail = await api().get(`/admin/leads/${leadId}`).set(as(asesor)).expect(200);
      expect(detail.body).toMatchObject({ submissionCount: 2, conversationId: null, optedOut: false });
      expect(detail.body.consents).toHaveLength(4);
      expect(detail.body.consents[0]).toMatchObject({
        channel: 'WEB',
        granted: true,
        textVersion: 'consent.web.privacy@1',
        textSnapshot: expect.stringContaining('Aviso de Privacidad'),
      });
      expect(detail.body.notes[0].body).toContain('Recontacto automático');

      const updated = await api()
        .patch(`/admin/leads/${leadId}`)
        .set(as(asesor))
        .send({ status: 'agendado', assignedToId: asesor.id })
        .expect(200);
      expect(updated.body).toMatchObject({ status: 'SCHEDULED', assignedTo: { id: asesor.id, name: 'Laura Asesora' } });
      expect(emit).toHaveBeenCalledWith('lead:changed', { leadId });
      expect(await prisma.auditLog.count({ where: { action: 'LEAD_STATUS_CHANGED', entityId: leadId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'LEAD_ASSIGNED', userId: asesor.id } })).toBe(1);

      const note = await api()
        .post(`/admin/leads/${leadId}/notes`)
        .set(as(asesor))
        .send({ body: '  Llamé y quedó de enviar el comparendo.  ' })
        .expect(201);
      expect(note.body).toMatchObject({
        body: 'Llamé y quedó de enviar el comparendo.',
        author: { name: 'Laura Asesora' },
      });
      const withNote = await api().get(`/admin/leads/${leadId}`).set(as(admin)).expect(200);
      expect(withNote.body.notes[0].body).toBe('Llamé y quedó de enviar el comparendo.');

      // Reasignar al ADMIN y luego dejar sin responsable
      await api().patch(`/admin/leads/${leadId}`).set(as(admin)).send({ assignedToId: admin.id }).expect(200);
      const cleared = await api()
        .patch(`/admin/leads/${leadId}`)
        .set(as(admin))
        .send({ assignedToId: null })
        .expect(200);
      expect(cleared.body.assignedTo).toBeNull();
    });

    it('validaciones: responsable inactivo, estado inválido, nota vacía y lead inexistente', async () => {
      const { leadId } = await submit();
      const inactive = await makeUser('baja@jurisglobal.test', Role.ASESOR, 'Inactivo');
      await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
      await api().patch(`/admin/leads/${leadId}`).set(as(admin)).send({ assignedToId: inactive.id }).expect(400);
      await api().patch(`/admin/leads/${leadId}`).set(as(admin)).send({ status: 'ganado' }).expect(400);
      await api().post(`/admin/leads/${leadId}/notes`).set(as(admin)).send({ body: '   ' }).expect(400);
      await api().get('/admin/leads/00000000-0000-4000-8000-000000000000').set(as(admin)).expect(404);

      const assignees = await api().get('/admin/leads/assignees').set(as(asesor)).expect(200);
      expect(assignees.body.map((u: { name: string }) => u.name)).not.toContain('Inactivo');
    });

    it('el detalle enlaza la conversación de WhatsApp del mismo número', async () => {
      const { leadId } = await submit();
      const conversation = await prisma.conversation.create({ data: { waId: '573001234567' } });
      const res = await api().get(`/admin/leads/${leadId}`).set(as(asesor)).expect(200);
      expect(res.body.conversationId).toBe(conversation.id);
      const list = await api().get('/admin/leads').set(as(asesor)).expect(200);
      expect(list.body.items[0].conversationId).toBe(conversation.id);
    });
  });

  describe('Exportación CSV', () => {
    it('UTF-8 con BOM, ";", tildes y eñes, +57 como texto y filtros activos (auditada sin la búsqueda)', async () => {
      await submit({ fullName: 'José Ñúñez Peña', email: 'jose@correo.co' });
      await submit({
        fullName: 'Otra Persona',
        phone: '3205556677',
        email: 'otra@correo.co',
        motivo: 'Insolvencia y deudas',
      });

      const res = await api()
        .get('/admin/leads/export')
        .query({
          motivoId: (await prisma.motivo.findUniqueOrThrow({ where: { name: 'Familia y tránsito' } })).id,
          q: 'ñúñez',
        })
        .set(as(asesor))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="leads-jurisglobal-.*\.csv"/);
      const bytes = res.body as Buffer;
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const csv = bytes.toString('utf8').slice(1);
      const lines = csv.trim().split('\r\n');
      expect(lines[0]).toBe(
        'Fecha de registro;Último envío;Nombre;Teléfono;Correo;Motivo;Origen;Último origen;Estado;Responsable;Envíos;Baja de mensajes;Anonimizado',
      );
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(
        ';José Ñúñez Peña;"=""+573001234567""";jose@correo.co;Familia y tránsito;Web;Web;Nuevo;;1;No;No',
      );

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LEADS_EXPORTED' } });
      expect(audit.userId).toBe(asesor.id);
      expect(audit.data).toMatchObject({ count: 1, filters: { hasSearch: true } });
      expect(JSON.stringify(audit.data)).not.toContain('ñúñez');
    });
  });

  describe('Anonimización (Ley 1581)', () => {
    it('ASESOR 403; ADMIN borra PII y conserva huella, consentimientos y supresión; elimina el chat', async () => {
      const { leadId } = await submit();
      await submit({ fullName: 'Ana Pérez' }); // nota automática con el nombre
      await api()
        .post(`/admin/leads/${leadId}/notes`)
        .set(as(admin))
        .send({ body: 'Vive en la calle 45 #12' })
        .expect(201);
      const conversation = await prisma.conversation.create({ data: { waId: '573001234567' } });
      await fs.mkdir(CHAT_MEDIA_ROOT, { recursive: true });
      const mediaFile = '0f8b4c1e-1a2b-4c3d-9e8f-123456789abc.pdf';
      await fs.writeFile(path.join(CHAT_MEDIA_ROOT, mediaFile), '%PDF-1.4 cédula');
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'INBOUND',
          author: 'CONTACT',
          type: 'document',
          body: 'Mi cédula',
          mediaKind: 'DOCUMENT',
          mediaFile,
        },
      });
      const consentsBefore = await prisma.consent.count({ where: { phoneHash: phoneHash('573001234567') } });

      await api().post(`/admin/leads/${leadId}/anonymize`).set(as(asesor)).expect(403);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).anonymizedAt).toBeNull();

      const res = await api().post(`/admin/leads/${leadId}/anonymize`).set(as(admin)).expect(200);
      expect(res.body).toMatchObject({ fullName: 'Titular anonimizado', email: null, phone: null });

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { notes: true } });
      expect(lead).toMatchObject({
        fullName: 'Titular anonimizado',
        email: null,
        phone: null,
        contactId: null,
        utm: null,
      });
      expect(lead.phoneHash).toBe(phoneHash('573001234567'));
      expect(lead.anonymizedAt).toBeInstanceOf(Date);
      expect(lead.notes).toHaveLength(2);
      expect(lead.notes.every((n) => n.body.includes('eliminado por anonimización'))).toBe(true);

      const consents = await prisma.consent.findMany({ where: { phoneHash: phoneHash('573001234567') } });
      expect(consents).toHaveLength(consentsBefore);
      expect(consents.every((c) => c.phone === null && c.leadId === leadId && c.textSnapshot.length > 10)).toBe(true);
      expect(JSON.stringify(consents.map((c) => c.evidence))).not.toMatch(/10\.0\.0\.1|jest/);

      const contact = await prisma.contact.findUniqueOrThrow({ where: { phoneHash: phoneHash('573001234567') } });
      expect(contact).toMatchObject({ phone: null, name: null, email: null, consentStatus: 'OPTED_OUT' });
      expect(await prisma.suppression.findUnique({ where: { phoneHash: phoneHash('573001234567') } })).toMatchObject({
        reason: 'ANONYMIZED',
      });
      expect(await prisma.conversation.count()).toBe(0);
      await expect(fs.stat(path.join(CHAT_MEDIA_ROOT, mediaFile))).rejects.toThrow();
      expect(await prisma.auditLog.count({ where: { action: 'LEAD_ANONYMIZED', userId: admin.id } })).toBe(1);

      // Idempotencia y regreso del titular: un envío nuevo crea otro lead sin chocar con el seudónimo
      await api().post(`/admin/leads/${leadId}/anonymize`).set(as(admin)).expect(409);
      const again = await submit({ fullName: 'Ana María Pérez' });
      expect(again.isNew).toBe(true);
      const contactAgain = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
      expect(contactAgain).toMatchObject({
        phone: '573001234567',
        name: 'Ana María Pérez',
        consentStatus: 'OPTED_OUT',
      });
    });

    it('un ADMIN con 2FA activo debe confirmar con Sudo Mode', async () => {
      const { leadId } = await submit();
      await prisma.user.update({ where: { id: admin.id }, data: { isTwoFactorEnabled: true } });
      const res = await api().post(`/admin/leads/${leadId}/anonymize`).set(as(admin)).expect(403);
      expect(res.body).toMatchObject({ message: 'SUDO_REQUIRED', reason: 'MISSING' });
    });
  });

  describe('Configuración (solo ADMIN)', () => {
    it('ASESOR recibe 403 en toda la configuración', async () => {
      const motivo = await prisma.motivo.findFirstOrThrow();
      const holiday = await prisma.holiday.findFirstOrThrow();
      const calls: Array<() => request.Test> = [
        () => api().get('/admin/settings'),
        () =>
          api()
            .patch('/admin/settings')
            .send({ values: { showConsultationPrice: true } }),
        () => api().get('/admin/motivos'),
        () => api().post('/admin/motivos').send({ name: 'Familia' }),
        () => api().patch(`/admin/motivos/${motivo.id}`).send({ isActive: false }),
        () =>
          api()
            .put('/admin/motivos/order')
            .send({ ids: [motivo.id] }),
        () => api().get('/admin/send-windows'),
        () => api().put('/admin/send-windows').send({ windows: [] }),
        () => api().get('/admin/holidays'),
        () => api().post('/admin/holidays').send({ date: '2026-12-31', name: 'x' }),
        () => api().delete(`/admin/holidays/${holiday.id}`),
      ];
      for (const call of calls) await call().set(as(asesor)).expect(403);
    });

    it('interruptor de precio y contacto institucional: se reflejan en /public/config y en la bitácora', async () => {
      const initial = await api().get('/admin/settings').set(as(admin)).expect(200);
      expect(initial.body).toMatchObject({
        showConsultationPrice: false,
        consultationPrice: null,
        'company.email': null,
      });

      const bad = await api()
        .patch('/admin/settings')
        .set(as(admin))
        .send({ values: { showConsultationPrice: true } })
        .expect(400);
      expect(bad.body.message).toContain('Para mostrar el precio, escribe el valor de la asesoría inicial');

      const saved = await api()
        .patch('/admin/settings')
        .set(as(admin))
        .send({
          values: {
            showConsultationPrice: true,
            consultationPrice: 100000,
            'notify.leadEmails': ['Socios@JurisGlobal.co'],
            'company.email': 'contacto@jurisglobal.co',
            'company.phone': '300 123 4567',
          },
        })
        .expect(200);
      expect(saved.body).toMatchObject({
        showConsultationPrice: true,
        consultationPrice: 100000,
        'notify.leadEmails': ['socios@jurisglobal.co'],
        'company.email': 'contacto@jurisglobal.co',
      });
      const config = await api().get('/public/config').expect(200);
      expect(config.body).toMatchObject({ showConsultationPrice: true, consultationPrice: 100000 });
      const row = await prisma.setting.findUniqueOrThrow({ where: { key: 'consultationPrice' } });
      expect(row.updatedById).toBe(admin.id);
      expect(await prisma.auditLog.findFirst({ where: { action: 'SETTING_UPDATED' } })).toMatchObject({
        data: { keys: expect.arrayContaining(['showConsultationPrice', 'consultationPrice']) },
      });

      await api()
        .patch('/admin/settings')
        .set(as(admin))
        .send({ values: { 'bot.closing': 'La consulta es gratis, escríbenos.' } })
        .expect(400);
      await api()
        .patch('/admin/settings')
        .set(as(admin))
        .send({ values: { 'consent.web.privacy': 'x' } })
        .expect(400);
      const text = 'Gracias, ya registramos tus datos. Un asesor te contactará pronto.';
      await api()
        .patch('/admin/settings')
        .set(as(admin))
        .send({ values: { 'bot.closing': text } })
        .expect(200);
      expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'bot.closing' } })).value).toBe(text);
    });

    it('motivos: crear, renombrar, reordenar y desactivar se reflejan en /public/config', async () => {
      const created = await api().post('/admin/motivos').set(as(admin)).send({ name: '  Sucesiones ' }).expect(201);
      expect(created.body.map((m: { name: string }) => m.name)).toEqual([...MOTIVOS, 'Sucesiones']);
      await api().post('/admin/motivos').set(as(admin)).send({ name: 'familia y transito' }).expect(409);
      await api().post('/admin/motivos').set(as(admin)).send({ name: 'Un nombre demasiado largo' }).expect(400);

      const byName = Object.fromEntries(created.body.map((m: { name: string; id: string }) => [m.name, m.id]));
      await api()
        .patch(`/admin/motivos/${byName['Sucesiones']}`)
        .set(as(admin))
        .send({ name: 'Herencias' })
        .expect(200);
      const order = [byName['Sucesiones'], ...MOTIVOS.map((n) => byName[n])];
      await api().put('/admin/motivos/order').set(as(admin)).send({ ids: order }).expect(200);
      await api()
        .put('/admin/motivos/order')
        .set(as(admin))
        .send({ ids: order.slice(1) })
        .expect(400);
      await api().patch(`/admin/motivos/${byName['Otro']}`).set(as(admin)).send({ isActive: false }).expect(200);

      const config = await api().get('/public/config').expect(200);
      expect(config.body.motivos.map((m: { name: string }) => m.name)).toEqual([
        'Herencias',
        ...MOTIVOS.filter((n) => n !== 'Otro'),
      ]);

      // Siempre queda al menos un motivo activo
      const remaining = order.filter((id) => id !== byName['Otro']);
      for (const id of remaining.slice(0, -1)) {
        await api().patch(`/admin/motivos/${id}`).set(as(admin)).send({ isActive: false }).expect(200);
      }
      const last = await api()
        .patch(`/admin/motivos/${remaining.at(-1)}`)
        .set(as(admin))
        .send({ isActive: false })
        .expect(400);
      expect(last.body.message).toContain('al menos un motivo activo');
    });

    it('ventanas horarias dentro de la Ley 2300 y topes de envío', async () => {
      const windows = (await api().get('/admin/send-windows').set(as(admin)).expect(200)).body;
      expect(windows).toHaveLength(7);
      expect(windows[0]).toMatchObject({ dayOfWeek: 0, enabled: false });

      const sunday = await api()
        .put('/admin/send-windows')
        .set(as(admin))
        .send({ windows: [{ dayOfWeek: 0, opensAt: '09:00', closesAt: '12:00', enabled: true }] })
        .expect(400);
      expect(sunday.body.message).toContain('Domingo: la Ley 2300 no permite envíos los domingos');
      const saturday = await api()
        .put('/admin/send-windows')
        .set(as(admin))
        .send({ windows: [{ dayOfWeek: 6, opensAt: '08:00', closesAt: '16:00', enabled: true }] })
        .expect(400);
      expect(saturday.body.message).toContain('Sábado: la Ley 2300 solo permite entre 08:00 y 15:00');
      await api()
        .put('/admin/send-windows')
        .set(as(admin))
        .send({ windows: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '09:00', enabled: true }] })
        .expect(400);

      await api()
        .put('/admin/send-windows')
        .set(as(admin))
        .send({
          windows: [
            { dayOfWeek: 1, opensAt: '08:00', closesAt: '18:00', enabled: true },
            { dayOfWeek: 6, opensAt: '08:00', closesAt: '12:00', enabled: false },
          ],
        })
        .expect(200);
      expect(await prisma.sendWindow.findUniqueOrThrow({ where: { dayOfWeek: 1 } })).toMatchObject({
        opensAt: '08:00',
        closesAt: '18:00',
      });
      expect((await prisma.sendWindow.findUniqueOrThrow({ where: { dayOfWeek: 6 } })).enabled).toBe(false);

      await api()
        .patch('/admin/settings')
        .set(as(admin))
        .send({
          values: {
            'marketing.maxPerContactPerDay': 1,
            'marketing.maxPerContactPerWeek': 3,
            'marketing.dailyGlobalLimit': 300,
          },
        })
        .expect(200);
      expect((await prisma.setting.findUniqueOrThrow({ where: { key: 'marketing.dailyGlobalLimit' } })).value).toBe(
        300,
      );
    });

    it('festivos: listar por año, agregar, quitar (manual se borra, oficial se desactiva) y duplicados', async () => {
      const year = new Date().getFullYear();
      const list = (await api().get('/admin/holidays').query({ year }).set(as(admin)).expect(200)).body;
      expect(list.length).toBeGreaterThanOrEqual(17);
      expect(list.every((h: { date: string }) => h.date.startsWith(String(year)))).toBe(true);

      const manual = await api()
        .post('/admin/holidays')
        .set(as(admin))
        .send({ date: `${year}-12-31`, name: 'Cierre de fin de año' })
        .expect(201);
      expect(manual.body).toMatchObject({ date: `${year}-12-31`, source: 'MANUAL', enabled: true });
      await api()
        .post('/admin/holidays')
        .set(as(admin))
        .send({ date: `${year}-12-31`, name: 'Otro' })
        .expect(409);
      await api()
        .post('/admin/holidays')
        .set(as(admin))
        .send({ date: `${year}-02-30`, name: 'No existe' })
        .expect(400);

      await api().delete(`/admin/holidays/${manual.body.id}`).set(as(admin)).expect(200);
      expect(await prisma.holiday.findUnique({ where: { id: manual.body.id } })).toBeNull();

      const official = list.find((h: { source: string }) => h.source === 'SEED');
      const removed = await api().delete(`/admin/holidays/${official.id}`).set(as(admin)).expect(200);
      expect(removed.body).toEqual({ removed: 'disabled' });
      expect((await prisma.holiday.findUniqueOrThrow({ where: { id: official.id } })).enabled).toBe(false);
      await api().patch(`/admin/holidays/${official.id}`).set(as(admin)).send({ enabled: true }).expect(200);
    });
  });

  describe('Usuarios (solo ADMIN)', () => {
    it('ASESOR 403; ADMIN lista, crea, cambia rol, desactiva y restablece contraseña', async () => {
      await api().get('/users').set(as(asesor)).expect(403);
      await api()
        .post('/users')
        .set(as(asesor))
        .send({ name: 'X', email: 'x@x.co', password: 'clave-segura-1', role: 'ADMIN' })
        .expect(403);

      const created = await api()
        .post('/users')
        .set(as(admin))
        .send({
          name: 'Jeremy Arenillas',
          email: 'Jeremy@JurisGlobal.test',
          password: 'clave-segura-1',
          role: 'ASESOR',
        })
        .expect(201);
      expect(created.body).toMatchObject({ email: 'jeremy@jurisglobal.test', role: 'ASESOR', isActive: true });
      expect(created.body).not.toHaveProperty('passwordHash');
      await api()
        .post('/users')
        .set(as(admin))
        .send({ name: 'Otro', email: 'jeremy@jurisglobal.test', password: 'clave-segura-1', role: 'ASESOR' })
        .expect(409);

      const promoted = await api()
        .patch(`/users/${created.body.id}`)
        .set(as(admin))
        .send({ role: 'ADMIN' })
        .expect(200);
      expect(promoted.body.role).toBe('ADMIN');
      await api().patch(`/users/${created.body.id}/status`).set(as(admin)).send({ isActive: false }).expect(200);
      await api()
        .patch(`/users/${created.body.id}/password`)
        .set(as(admin))
        .send({ password: 'otra-clave-segura' })
        .expect(200);

      const list = await api().get('/users').set(as(admin)).expect(200);
      expect(list.body.find((u: { id: string }) => u.id === created.body.id)).toMatchObject({
        role: 'ADMIN',
        isActive: false,
      });
    });

    it('nunca se desactiva ni se degrada al último ADMIN activo; la propia cuenta no se desactiva', async () => {
      // Solo queda activo el ADMIN de la prueba (el del seed se desactiva)
      await prisma.user.updateMany({ where: { role: 'ADMIN', id: { not: admin.id } }, data: { isActive: false } });

      const demote = await api().patch(`/users/${admin.id}`).set(as(admin)).send({ role: 'ASESOR' }).expect(400);
      expect(demote.body.message).toContain('al menos un administrador activo');
      await api().patch(`/users/${admin.id}/status`).set(as(admin)).send({ isActive: false }).expect(403);

      // Con otro ADMIN activo sí se puede degradar
      const second = await makeUser('socio2@jurisglobal.test', Role.ADMIN, 'Jeremy Socio');
      await api().patch(`/users/${second.id}`).set(as(admin)).send({ role: 'ASESOR' }).expect(200);
      await api().patch(`/users/${second.id}`).set(as(admin)).send({ role: 'ADMIN' }).expect(200);
      await api().patch(`/users/${admin.id}`).set(as(second)).send({ role: 'ASESOR' }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ASESOR');
      // second es ahora el único ADMIN activo
      await api().patch(`/users/${second.id}`).set(as(second)).send({ role: 'ASESOR' }).expect(400);
    });
  });
});
