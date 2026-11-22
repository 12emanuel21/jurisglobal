import type { MsgStatus } from '@prisma/client';

const RANK: Record<MsgStatus, number> = { RECEIVED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/**
 * ¿Aplicar el nuevo estado de Meta? Los webhooks llegan desordenados: un "delivered" tardío no
 * debe pisar un "read" (corrige el bug del módulo Django, que sí lo pisaba en los destinatarios).
 * READ y FAILED son terminales; FAILED aplica sobre SENT/DELIVERED.
 */
export function isStatusUpgrade(current: MsgStatus | null | undefined, next: MsgStatus): boolean {
  if (!current) return true;
  if (current === 'READ' || current === 'FAILED') return false;
  return RANK[next] > RANK[current];
}

/** Estado de Meta ("sent" | "delivered" | "read" | "failed") -> enum; null si es desconocido */
export function parseMetaStatus(value: unknown): MsgStatus | null {
  switch (value) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}
