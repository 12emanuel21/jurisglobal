/**
 * RBAC en el frontend (solo UX: la autorización real la aplica el backend).
 * - ADMIN (socios): todo el panel, configuración, usuarios, masivos y anonimización.
 * - ASESOR (equipo): leads, notas, exportación, inbox y su cuenta.
 */
export type UserRole = 'ADMIN' | 'ASESOR';

export const ROLE_LABELS: Record<UserRole, string> = { ADMIN: 'Administrador', ASESOR: 'Asesor' };

/** Rutas del panel solo para ADMIN */
const ADMIN_ONLY_PREFIXES = ['/panel/masivos', '/panel/configuracion', '/panel/usuarios'];

export const PANEL_HOME = '/panel';

export function canAccessPanelPath(role: string | undefined, pathname: string): boolean {
  if (role === 'ADMIN') return true;
  if (role !== 'ASESOR') return false;
  return !ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
