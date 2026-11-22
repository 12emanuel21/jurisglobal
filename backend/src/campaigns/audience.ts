import type { CampaignKind, ContactConsentStatus, Prisma } from '@prisma/client';
import { startOfLocalDay } from '../compliance/send-window';
import type { PrismaService } from '../prisma/prisma.service';
import { VERIFIED_STATUSES } from './campaign-engine';

export type AudienceType = 'all' | 'source' | 'selection';
export interface Audience {
  type: AudienceType;
  /** type=source: valores de "Origen" (Contact.sourceDetail) */
  sources?: string[];
  /** type=selection: ids de contactos */
  contactIds?: string[];
}

/** Motivos de exclusión al armar la campaña (quedan como SKIPPED con su motivo) */
export type ExclusionReason = 'OPTED_OUT' | 'NO_CONSENT' | 'ALREADY_VERIFIED';

export interface AudienceMember {
  id: string;
  phone: string;
  name: string | null;
  exclusion: ExclusionReason | null;
}

export interface AudienceSummary {
  /** Contactos de la audiencia elegida (con teléfono; los anonimizados no cuentan) */
  total: number;
  recipients: number;
  excluded: { optedOut: number; unverified: number; alreadyVerified: number; total: number };
  /** Destinatarios que hoy ya alcanzaron su tope: se envían cuando se libere el cupo (no se descartan) */
  frequencyCapped: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function audienceWhere(audience: Audience): Prisma.ContactWhereInput {
  const base: Prisma.ContactWhereInput = { phone: { not: null }, anonymizedAt: null };
  if (audience.type === 'source') return { ...base, sourceDetail: { in: audience.sources ?? [] } };
  if (audience.type === 'selection') return { ...base, id: { in: audience.contactIds ?? [] } };
  return base;
}

/**
 * Regla de cumplimiento (Ley 1581): marketing solo a contactos con soporte documental o con la
 * autorización confirmada por WhatsApp; los no verificados solo reciben la campaña de confirmación
 * (OPT_IN), que a su vez no se manda a quien ya está verificado. Las bajas nunca reciben nada.
 */
export function exclusionFor(
  kind: CampaignKind,
  status: ContactConsentStatus,
  suppressed: boolean,
): ExclusionReason | null {
  if (suppressed || status === 'OPTED_OUT') return 'OPTED_OUT';
  const verified = (VERIFIED_STATUSES as readonly string[]).includes(status);
  if (kind === 'MARKETING' && !verified) return 'NO_CONSENT';
  if (kind === 'OPT_IN' && verified) return 'ALREADY_VERIFIED';
  return null;
}

export async function resolveAudience(
  prisma: PrismaService,
  audience: Audience,
  kind: CampaignKind,
): Promise<AudienceMember[]> {
  const contacts = await prisma.contact.findMany({
    where: audienceWhere(audience),
    select: { id: true, phone: true, phoneHash: true, name: true, consentStatus: true, optedOutAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const suppressed = new Set(
    (
      await prisma.suppression.findMany({
        where: { phoneHash: { in: contacts.map((c) => c.phoneHash) } },
        select: { phoneHash: true },
      })
    ).map((s) => s.phoneHash),
  );
  return contacts.map((c) => ({
    id: c.id,
    phone: c.phone!,
    name: c.name,
    exclusion: exclusionFor(kind, c.consentStatus, suppressed.has(c.phoneHash) || Boolean(c.optedOutAt)),
  }));
}

/** Resumen para la vista previa (incluye cuántos están hoy en su tope de frecuencia) */
export async function summarizeAudience(
  prisma: PrismaService,
  members: AudienceMember[],
  caps: { maxPerDay: number; maxPerWeek: number },
  now = new Date(),
): Promise<AudienceSummary> {
  const count = (r: ExclusionReason) => members.filter((m) => m.exclusion === r).length;
  const recipients = members.filter((m) => !m.exclusion);
  let frequencyCapped = 0;
  if (recipients.length) {
    const ids = recipients.map((m) => m.id);
    const real = { campaign: { dryRun: false } };
    const [today, week] = await Promise.all([
      prisma.campaignMessage.groupBy({
        by: ['contactId'],
        where: { contactId: { in: ids }, sentAt: { gte: startOfLocalDay(now) }, ...real },
        _count: { _all: true },
      }),
      prisma.campaignMessage.groupBy({
        by: ['contactId'],
        where: { contactId: { in: ids }, sentAt: { gt: new Date(now.getTime() - WEEK_MS) }, ...real },
        _count: { _all: true },
      }),
    ]);
    const capped = new Set([
      ...today.filter((g) => g._count._all >= caps.maxPerDay).map((g) => g.contactId),
      ...week.filter((g) => g._count._all >= caps.maxPerWeek).map((g) => g.contactId),
    ]);
    frequencyCapped = capped.size;
  }
  const excluded = {
    optedOut: count('OPTED_OUT'),
    unverified: count('NO_CONSENT'),
    alreadyVerified: count('ALREADY_VERIFIED'),
    total: members.length - recipients.length,
  };
  return { total: members.length, recipients: recipients.length, excluded, frequencyCapped };
}
