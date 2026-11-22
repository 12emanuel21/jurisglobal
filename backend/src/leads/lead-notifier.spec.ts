import { resetEnvCache } from '../config/env';
import { LeadNotifier, resolveRecipients } from './lead-notifier';

const data = {
  leadId: 'l1',
  isNew: true,
  fullName: 'Ana Pérez',
  phone: '573001234567',
  email: 'ana@correo.co',
  motivo: 'Tránsito',
  origin: 'WEB' as const,
  submissionCount: 1,
  receivedAt: new Date(),
  differences: [],
};

describe('LeadNotifier', () => {
  beforeAll(() => {
    Object.assign(process.env, {
      PUBLIC_BASE_URL: 'http://localhost:8088',
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://x',
      JWT_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: 'a'.repeat(64),
      LEAD_NOTIFICATION_EMAIL: 'equipo@jurisglobal.test, OTRO@jurisglobal.test',
    });
    resetEnvCache();
  });
  afterAll(() => resetEnvCache());

  const settings = (emails: unknown) => ({ get: jest.fn().mockResolvedValue(emails) });

  it('resolveRecipients: Configuración tiene prioridad; si está vacía, la variable de entorno', () => {
    expect(resolveRecipients(['socio@jurisglobal.test'], 'a@b.co')).toEqual(['socio@jurisglobal.test']);
    expect(resolveRecipients([], ' a@b.co, A@B.co ,malo ')).toEqual(['a@b.co']);
    expect(resolveRecipients(null, undefined)).toEqual([]);
  });

  it('envía a los destinatarios de la variable de entorno', async () => {
    const mail = { isConfigured: () => true, send: jest.fn().mockResolvedValue(undefined) };
    const notifier = new LeadNotifier(mail as any, settings([]) as any);
    await expect(notifier.notify(data, [0])).resolves.toBe(true);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['equipo@jurisglobal.test', 'otro@jurisglobal.test'] }),
    );
  });

  it('reintenta ante fallos del SMTP y nunca lanza', async () => {
    const mail = {
      isConfigured: () => true,
      send: jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(undefined),
    };
    const notifier = new LeadNotifier(mail as any, settings([]) as any);
    await expect(notifier.notify(data, [0, 0, 0])).resolves.toBe(true);
    expect(mail.send).toHaveBeenCalledTimes(2);

    const down = { isConfigured: () => true, send: jest.fn().mockRejectedValue(new Error('SMTP caído')) };
    await expect(new LeadNotifier(down as any, settings([]) as any).notify(data, [0, 0])).resolves.toBe(false);
    expect(down.send).toHaveBeenCalledTimes(2);
  });

  it('sin SMTP configurado no intenta enviar', async () => {
    const mail = { isConfigured: () => false, send: jest.fn() };
    await expect(new LeadNotifier(mail as any, settings([]) as any).notify(data, [0])).resolves.toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
  });
});
