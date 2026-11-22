'use client';

import { useAuth } from '@/context/AuthContext';
import { UsersView } from '@/components/users/UsersView';

/** Usuarios del equipo (solo ADMIN: lo exigen el layout y el backend) */
export default function UsersPage() {
  const { user } = useAuth();
  return user ? <UsersView currentUserId={user.id} /> : null;
}
