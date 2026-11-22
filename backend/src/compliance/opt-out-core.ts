import { ConsentPurpose, Prisma } from '@prisma/client';
import { phoneHash } from '../common/crypto';

/** KEYWORD (STOP escrito), TEMPLATE_BUTTON (botón de baja de una plantilla), META_131050, PANEL (manual) */
export type OptOutChannel = 'KEYWORD' | 'TEMPLATE_BUTTON' | 'META_131050' | 'PANEL';

export interface OptOutInput {
  /** E.164 sin "+" */
  phone: string;
  channel: OptOutChannel;
  /** Evidencia legible (texto de la persona, botón, código de Meta o nota del panel) */
  detail: string;
  evidence: Prisma.InputJsonValue;
  /** Contacto de origen nuevo si no existía (STOP de alguien que nunca estuvo en la base) */
  createSource?: 'WHATSAPP' | 'PANEL';
}

export interface OptOutResult {
  contactId: string;
  leadId: string | null;
  /** Campaña cuyo último envío se atribuye la baja (métrica "bajas") */
  campaignId: string | null;
  alreadyOptedOut: boolean;
}

const TEXT_VERSION: Record<OptOutChannel, string> = {
  KEYWORD: 'optout.keyword@1',
  TEMPLATE_BUTTON: 'optout.template-button@1',
  META_131050: 'optout.meta-131050@1',
  PANEL: 'optout.panel@1',
};
const SNAPSHOT: Record<OptOutChannel, string> = {
  KEYWORD: 'Solicitud de baja por WhatsApp',
  TEMPLATE_BUTTON: 'Baja con el botón de la plantilla',
  META_131050: 'Meta informó que la persona bloqueó el marketing de JurisGlobal (error 131050)',
  PANEL: 'Baja registrada manualmente desde el panel',
};
const NOTE: Record<OptOutChannel, string> = {
  KEYWORD: 'Baja por WhatsApp: la persona escribió',
  TEMPLATE_BUTTON: 'Baja con el botón de una campaña:',
  META_131050: 'Baja automática: Meta informó que la persona bloqueó el marketing de la empresa.',
  PANEL: 'Baja manual desde el panel.',
};

/** Ventana para atribuir una baja al último envío de campaña recibido */
export const OPT_OUT_ATTRIBUTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Baja inmediata (Ley 2300 de 2023 art. 5 par. 2 y Ley 1581 de 2012) dentro de una transacción:
 * contacto OPTED_OUT, seudónimo en la lista de supresión (sobrevive a la anonimización), revocación
 * en Consent, nota en el lead y atribución al último envío de campaña. Idempotente: una segunda
 * baja no duplica la revocación.
 */
export async function applyOptOut(tx: Prisma.TransactionClient, input: OptOutInput): Promise<OptOutResult> {
  const hash = phoneHash(input.phone);
  const now = new Date();
  const before = await tx.contact.findUnique({ where: { phoneHash: hash }, select: { consentStatus: true } });
  const alreadyOptedOut = before?.consentStatus === 'OPTED_OUT';
  const optOut = { consentStatus: 'OPTED_OUT' as const, optedOutAt: now, optOutChannel: input.channel };

  const contact = await tx.contact.upsert({
    where: { phoneHash: hash },
    create: { phone: input.phone, phoneHash: hash, source: input.createSource ?? 'WHATSAPP', ...optOut },
    update: alreadyOptedOut ? {} : optOut,
  });
  await tx.suppression.upsert({
    where: { phoneHash: hash },
    create: { phoneHash: hash, reason: input.channel },
    update: {},
  });
  const lead = await tx.lead.findUnique({ where: { phone: input.phone }, select: { id: true } });

  let campaignId: string | null = null;
  if (!alreadyOptedOut) {
    await tx.consent.create({
      data: {
        leadId: lead?.id ?? null,
        contactId: contact.id,
        phone: input.phone,
        phoneHash: hash,
        purpose: ConsentPurpose.MARKETING_WHATSAPP,
        granted: false,
        channel: input.channel === 'PANEL' ? 'PANEL' : 'WHATSAPP',
        textVersion: TEXT_VERSION[input.channel],
        textSnapshot: `${SNAPSHOT[input.channel]}: «${input.detail.slice(0, 200)}»`,
        evidence: input.evidence,
      },
    });
    if (lead) {
      const quoted = input.channel === 'KEYWORD' || input.channel === 'TEMPLATE_BUTTON';
      await tx.leadNote.create({
        data: {
          leadId: lead.id,
          body: `${NOTE[input.channel]}${quoted ? ` «${input.detail.slice(0, 80)}».` : ''} No recibirá más mensajes automáticos ni masivos.`,
        },
      });
    }
    const last = await tx.campaignMessage.findFirst({
      where: { contactId: contact.id, sentAt: { gte: new Date(now.getTime() - OPT_OUT_ATTRIBUTION_MS) } },
      orderBy: { sentAt: 'desc' },
      select: { id: true, campaignId: true, optedOutAt: true },
    });
    if (last && !last.optedOutAt) {
      await tx.campaignMessage.update({ where: { id: last.id }, data: { optedOutAt: now } });
      campaignId = last.campaignId;
    }
  }
  return { contactId: contact.id, leadId: lead?.id ?? null, campaignId, alreadyOptedOut };
}
