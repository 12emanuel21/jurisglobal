import { Megaphone, MessagesSquare, Settings, UserCog, Users, ClipboardList, type LucideIcon } from 'lucide-react';
import { canAccessPanelPath } from '@/lib/roles';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Navegación del panel (fuente única para Sidebar y TopBar); se filtra por rol */
const ALL_ITEMS: NavItem[] = [
  { label: 'Leads', href: '/panel', icon: ClipboardList },
  { label: 'Inbox', href: '/panel/conversaciones', icon: MessagesSquare },
  { label: 'Masivos', href: '/panel/masivos', icon: Megaphone },
  { label: 'Configuración', href: '/panel/configuracion', icon: Settings },
  { label: 'Usuarios', href: '/panel/usuarios', icon: Users },
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
