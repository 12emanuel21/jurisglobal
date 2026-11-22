'use client';

import { useAuth } from '@/context/AuthContext';
import { LeadsView } from '@/components/leads/LeadsView';

/** Inicio del panel = Leads (ESP §8). Anonimizar solo para ADMIN (el backend lo exige igual) */
export default function PanelHome() {
  const { user } = useAuth();
  return <LeadsView isAdmin={user?.role === 'ADMIN'} />;
}
