import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { resetEnvCache } from '../config/env';
import { WebhookController } from './webhook.controller';

describe('WebhookController (verificación y firma)', () => {
  const processor = { handlePayload: jest.fn().mockResolvedValue(undefined) };
  const controller = new WebhookController(processor as any);

  beforeAll(() => {
    Object.assign(process.env, {
      PUBLIC_BASE_URL: 'http://localhost:8088',
      DATABASE_URL: 'postgresql://x',
      REDIS_URL: 'redis://x',
      JWT_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: 'a'.repeat(64),
      WHATSAPP_VERIFY_TOKEN: 'token-correcto',
      META_APP_SECRET: 'secreto-app',
    });
    resetEnvCache();
  });
  afterAll(() => resetEnvCache());

  it('GET: devuelve el challenge solo con modo subscribe y token exacto', () => {
    expect(controller.verify('subscribe', 'token-correcto', '12345')).toBe('12345');
    expect(() => controller.verify('subscribe', 'otro', '12345')).toThrow(ForbiddenException);
    expect(() => controller.verify('subscribe', undefined, '12345')).toThrow(ForbiddenException);
    expect(() => controller.verify('unsubscribe', 'token-correcto', '12345')).toThrow(ForbiddenException);
  });

  it('POST: procesa solo con firma válida sobre el cuerpo crudo', () => {
    const body = { object: 'whatsapp_business_account', entry: [] };
    const rawBody = Buffer.from(JSON.stringify(body));
    const sig = 'sha256=' + createHmac('sha256', 'secreto-app').update(rawBody).digest('hex');

    expect(controller.receive({ headers: { 'x-hub-signature-256': sig }, rawBody, body } as any)).toBe(
      'EVENT_RECEIVED',
    );
    expect(processor.handlePayload).toHaveBeenCalledWith(body);

    processor.handlePayload.mockClear();
    expect(() => controller.receive({ headers: { 'x-hub-signature-256': 'sha256=00' }, rawBody, body } as any)).toThrow(
      ForbiddenException,
    );
    expect(() => controller.receive({ headers: {}, rawBody, body } as any)).toThrow(ForbiddenException);
    expect(processor.handlePayload).not.toHaveBeenCalled();
  });
});
