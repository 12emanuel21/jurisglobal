import { LayoutDashboard, MessagesSquare, UserCog, type LucideIcon } from 'lucide-react';
import { canAccessPanelPath } from '@/lib/roles';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Navegación del panel (fuente única para Sidebar y TopBar). Las secciones de leads, contactos,
 * campañas y configuración se agregan en las etapas 5 y 6.
 */
const ALL_ITEMS: NavItem[] = [
  { label: 'Inicio', href: '/panel', icon: LayoutDashboard },
  { label: 'Conversaciones', href: '/panel/conversaciones', icon: MessagesSquare },
  { label: 'Mi cuenta', href: '/panel/cuenta', icon: UserCog },
];

export function getNavItems(role?: string): NavItem[] {
  return ALL_ITEMS.filter((item) => canAccessPanelPath(role, item.href));
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/panel') return pathname === '/panel';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string): string {
  return ALL_ITEMS.find((item) => isNavItemActive(pathname, item.href))?.label ?? 'Panel';
}
