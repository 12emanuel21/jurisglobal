import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { loadEnv } from '../config/env';

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/**
 * Correo saliente por SMTP (Gmail con contraseña de aplicación, ESP §8). Sin SMTP configurado la API
 * arranca igual y deja una advertencia clara: los avisos no se envían, pero nada más falla.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  onModuleInit() {
    const env = loadEnv();
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
      this.logger.warn(
        '⚠️ SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASS): los avisos de leads por correo están desactivados',
      );
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    // Verificación en segundo plano: un SMTP caído no impide arrancar
    this.transporter
      .verify()
      .then(() => this.logger.log(`📧 SMTP listo (${env.SMTP_HOST}:${env.SMTP_PORT})`))
      .catch((error: Error) => this.logger.warn(`⚠️ SMTP no responde todavía: ${error.message}`));
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) throw new Error('SMTP no configurado');
    const env = loadEnv();
    await this.transporter.sendMail({
      from: env.SMTP_FROM ?? env.SMTP_USER,
      to: message.to.join(', '),
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
