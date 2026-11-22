import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { maskEmail } from '../common/redact';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { buildLeadEmail, type LeadEmailData } from './lead-email';

/** Reintentos del correo (ms antes de cada intento). En la Etapa 6 pasa a una cola de BullMQ. */
export const NOTIFY_RETRY_DELAYS_MS = [0, 5_000, 30_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Destinatarios: Configuración (notify.leadEmails) y, si está vacío, LEAD_NOTIFICATION_EMAIL */
export function resolveRecipients(fromSettings: unknown, fromEnv: string | undefined): string[] {
  const list = Array.isArray(fromSettings) ? fromSettings.filter((x): x is string => typeof x === 'string') : [];
  const source = list.length ? list : (fromEnv ?? '').split(',');
  return [...new Set(source.map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))];
}

/**
 * Aviso por correo de lead nuevo o recontacto. Nunca lanza: se llama sin await después de guardar
 * el lead, así un SMTP caído jamás impide registrar a la persona.
 */
@Injectable()
export class LeadNotifier {
  private readonly logger = new Logger(LeadNotifier.name);

  constructor(
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async notify(data: Omit<LeadEmailData, 'panelBaseUrl'>, delays: number[] = NOTIFY_RETRY_DELAYS_MS): Promise<boolean> {
    try {
      if (!this.mail.isConfigured()) {
        this.logger.warn(`Lead ${data.leadId}: SMTP no configurado, no se envió el aviso por correo`);
        return false;
      }
      const to = resolveRecipients(await this.settings.get('notify.leadEmails'), loadEnv().LEAD_NOTIFICATION_EMAIL);
      if (!to.length) {
        this.logger.warn(`Lead ${data.leadId}: no hay destinatarios (notify.leadEmails / LEAD_NOTIFICATION_EMAIL)`);
        return false;
      }
      const message = { to, ...buildLeadEmail({ ...data, panelBaseUrl: loadEnv().PUBLIC_BASE_URL }) };
      for (const [attempt, delay] of delays.entries()) {
        if (delay) await sleep(delay);
        try {
          await this.mail.send(message);
          this.logger.log(`📧 Aviso del lead ${data.leadId} enviado a ${to.map(maskEmail).join(', ')}`);
          return true;
        } catch (error) {
          this.logger.warn(
            `Aviso del lead ${data.leadId}: intento ${attempt + 1}/${delays.length} falló (${(error as Error).message})`,
          );
        }
      }
      this.logger.error(`❌ No se pudo enviar el aviso del lead ${data.leadId} tras ${delays.length} intentos`);
      return false;
    } catch (error) {
      this.logger.error(`❌ Error preparando el aviso del lead ${data.leadId}: ${(error as Error).message}`);
      return false;
    }
  }
}
