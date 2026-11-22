import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { loadEnv } from '../config/env';
import { maskPhone } from '../common/redact';

/** Error de la Graph API con el código de Meta (para clasificar en masivos y en el Inbox) */
export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: number,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super('WhatsApp Cloud API no está configurado (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)');
    this.name = 'WhatsAppNotConfiguredError';
  }
}

export interface ReplyButton {
  id: string;
  title: string;
}
export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

/**
 * Límites de Meta para mensajes interactivos (verificar contra la documentación vigente en la
 * Etapa 4): hasta 3 botones de respuesta con título de máx. 20 caracteres; listas de máx. 10 filas
 * con título de máx. 24 y descripción de máx. 72; cuerpo de máx. 1024.
 */
export const INTERACTIVE_LIMITS = {
  buttons: 3,
  buttonTitle: 20,
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  body: 1024,
} as const;

export function buildButtonsPayload(to: string, body: string, buttons: ReplyButton[]) {
  if (!buttons.length || buttons.length > INTERACTIVE_LIMITS.buttons) throw new Error('Entre 1 y 3 botones');
  if (buttons.some((b) => !b.title.trim() || b.title.length > INTERACTIVE_LIMITS.buttonTitle)) {
    throw new Error(`El título de cada botón debe tener 1 a ${INTERACTIVE_LIMITS.buttonTitle} caracteres`);
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body.slice(0, INTERACTIVE_LIMITS.body) },
      action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    },
  };
}

export function buildListPayload(
  to: string,
  body: string,
  buttonText: string,
  rows: ListRow[],
  sectionTitle = 'Opciones',
) {
  if (!rows.length || rows.length > INTERACTIVE_LIMITS.rows) throw new Error('Entre 1 y 10 opciones');
  if (rows.some((r) => !r.title.trim() || r.title.length > INTERACTIVE_LIMITS.rowTitle)) {
    throw new Error(`El título de cada opción debe tener 1 a ${INTERACTIVE_LIMITS.rowTitle} caracteres`);
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body.slice(0, INTERACTIVE_LIMITS.body) },
      action: {
        button: buttonText.slice(0, INTERACTIVE_LIMITS.buttonTitle),
        sections: [
          {
            title: sectionTitle.slice(0, 24),
            rows: rows.map((r) => ({
              id: r.id,
              title: r.title,
              ...(r.description ? { description: r.description.slice(0, INTERACTIVE_LIMITS.rowDescription) } : {}),
            })),
          },
        ],
      },
    },
  };
}

/** Plantilla aprobada con parámetros posicionales del cuerpo ({{1}}, {{2}}…) */
export function buildTemplatePayload(to: string, name: string, language: string, bodyParams: string[] = []) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(bodyParams.length
        ? { components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }] }
        : {}),
    },
  };
}

/**
 * Cliente oficial de WhatsApp Cloud API (Graph). Adaptado de MetaWhatsAppService de KovalCloud:
 * sin Baileys, credenciales del entorno (un solo número), versión de Graph configurable y errores
 * tipados con el código de Meta. Nunca registra el contenido de los mensajes.
 */
@Injectable()
export class WhatsAppCloudApi {
  private readonly logger = new Logger(WhatsAppCloudApi.name);

  isConfigured(): boolean {
    const env = loadEnv();
    return Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN);
  }

  private config() {
    const env = loadEnv();
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) throw new WhatsAppNotConfiguredError();
    return {
      base: `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}`,
      phoneId: env.WHATSAPP_PHONE_NUMBER_ID,
      token: env.WHATSAPP_ACCESS_TOKEN,
    };
  }

  private async post(body: unknown, label: string, to: string): Promise<{ waMessageId: string }> {
    const { base, phoneId, token } = this.config();
    const res = await fetch(`${base}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data?.error ?? {};
      this.logger.warn(`❌ ${label} a ${maskPhone(to)} rechazado (${res.status}, código ${err.code ?? '—'})`);
      throw new WhatsAppApiError(
        err.message ?? `Graph API ${res.status}`,
        res.status,
        err.code,
        err.error_data?.details,
      );
    }
    const waMessageId = data?.messages?.[0]?.id;
    if (!waMessageId) throw new WhatsAppApiError('Respuesta de Graph sin id de mensaje', res.status);
    return { waMessageId };
  }

  sendText(to: string, body: string) {
    return this.post(
      { messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } },
      'Texto',
      to,
    );
  }

  sendButtons(to: string, body: string, buttons: ReplyButton[]) {
    return this.post(buildButtonsPayload(to, body, buttons), 'Botones', to);
  }

  sendList(to: string, body: string, buttonText: string, rows: ListRow[]) {
    return this.post(buildListPayload(to, body, buttonText, rows), 'Lista', to);
  }

  sendTemplate(to: string, name: string, language: string, bodyParams: string[] = []) {
    return this.post(buildTemplatePayload(to, name, language, bodyParams), 'Plantilla', to);
  }

  /** Documento desde un archivo local (se sube a /media) o un enlace público */
  async sendDocument(to: string, source: { filePath: string } | { link: string }, filename: string, caption = '') {
    const { base, phoneId, token } = this.config();
    const document: Record<string, string> = { filename, ...(caption ? { caption } : {}) };
    if ('filePath' in source) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'application/pdf');
      form.append('file', new Blob([await fs.readFile(source.filePath)], { type: 'application/pdf' }), filename);
      const res = await fetch(`${base}/${phoneId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data.id)
        throw new WhatsAppApiError(
          data?.error?.message ?? 'No se pudo subir el documento',
          res.status,
          data?.error?.code,
        );
      document.id = data.id;
    } else {
      document.link = source.link;
    }
    return this.post(
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document', document },
      'Documento',
      to,
    );
  }

  /** ¿Hay credenciales para leer las plantillas de la cuenta (WABA)? */
  canSyncTemplates(): boolean {
    const env = loadEnv();
    return Boolean(env.WHATSAPP_WABA_ID && env.WHATSAPP_ACCESS_TOKEN);
  }

  /** Todas las plantillas de la WABA (Graph pagina de a 100) */
  async listTemplates(): Promise<unknown[]> {
    const env = loadEnv();
    if (!env.WHATSAPP_WABA_ID || !env.WHATSAPP_ACCESS_TOKEN) throw new WhatsAppNotConfiguredError();
    const base = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}`;
    let url: string | null =
      `${base}/${encodeURIComponent(env.WHATSAPP_WABA_ID)}/message_templates?fields=id,name,language,category,status,components&limit=100`;
    const all: unknown[] = [];
    for (let page = 0; url && page < 50; page++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new WhatsAppApiError(data?.error?.message ?? `Graph API ${res.status}`, res.status, data?.error?.code);
      if (Array.isArray(data?.data)) all.push(...data.data);
      url = typeof data?.paging?.next === 'string' ? data.paging.next : null;
    }
    return all;
  }

  /** Marca un mensaje entrante como leído (doble check azul) */
  async markAsRead(waMessageId: string): Promise<void> {
    const { base, phoneId, token } = this.config();
    await fetch(`${base}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }),
    }).catch(() => undefined);
  }

  /** Descarga un adjunto entrante: GET /{mediaId} -> url temporal -> binario (ambos con el token) */
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mime: string | null }> {
    const { base, token } = this.config();
    const meta = await fetch(`${base}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await meta.json().catch(() => ({}));
    if (!meta.ok || !data.url)
      throw new WhatsAppApiError('No se pudo obtener la URL del adjunto', meta.status, data?.error?.code);
    const file = await fetch(data.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!file.ok) throw new WhatsAppApiError('No se pudo descargar el adjunto', file.status);
    return { buffer: Buffer.from(await file.arrayBuffer()), mime: data.mime_type ?? null };
  }
}
