'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { useSudoMode } from '@/context/SudoContext';
import { apiErrorMessage, apiJson } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABELS, type UserRole } from '@/lib/roles';
import { btnPrimary, btnSecondary, card, errorText, heading, input, label, muted } from '@/components/panel/ui';
import { SaveFeedback, type Feedback } from '@/components/settings/SaveFeedback';

export interface PanelUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  isTwoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const json = (body: unknown) => JSON.stringify(body);

/**
 * Usuarios del equipo (solo ADMIN): crear, cambiar rol, activar/desactivar y restablecer
 * contraseña. El servidor impide desactivar o degradar al último ADMIN activo y desactivar la
 * propia cuenta; restablecer contraseñas pide el código 2FA si la cuenta del ADMIN lo tiene.
 */
export function UsersView({ currentUserId }: { currentUserId: string }) {
  const { sudoFetch } = useSudoMode();
  const [users, setUsers] = useState<PanelUser[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'ASESOR' as UserRole });
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<{ id: string; password: string } | null>(null);

  const load = useCallback(
    () =>
      apiJson<PanelUser[]>('/users', {}, 'No se pudieron cargar los usuarios')
        .then(setUsers)
        .catch((err: unknown) => setFeedback({ ok: false, text: errorText(err) })),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    setFeedback(null);
    try {
      await action();
      await load();
      setFeedback({ ok: true, text: ok });
      return true;
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudo guardar') });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFeedback(null);
    try {
      await apiJson('/users', { method: 'POST', body: json(form) }, 'No se pudo crear el usuario');
      setForm({ name: '', email: '', password: '', role: 'ASESOR' });
      await load();
      setFeedback({ ok: true, text: 'Usuario creado. Comparte la contraseña por un canal seguro y pídele activar la verificación en 2 pasos.' });
    } catch (err) {
      setFeedback({ ok: false, text: errorText(err, 'No se pudo crear el usuario') });
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetFor) return;
    const done = await act(
      resetFor.id,
      async () => {
        const res = await sudoFetch(`/users/${resetFor.id}/password`, { method: 'PATCH', body: json({ password: resetFor.password }) });
        if (!res.ok) throw new Error((await apiErrorMessage(res, 'No se pudo restablecer la contraseña')).message);
      },
      'Contraseña restablecida. Sus sesiones abiertas se cerraron.',
    );
    if (done) setResetFor(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className={heading}>Usuarios</h2>
        <p className={`text-sm ${muted}`}>Socios (Administrador) y equipo (Asesor). El asesor no ve Configuración, Usuarios ni Masivos.</p>
      </div>

      <SaveFeedback feedback={feedback} />

      <section className={`${card} overflow-hidden`} aria-label="Equipo">
        {!users ? (
          <p className={`flex items-center gap-2 p-5 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {users.map((u) => {
              const self = u.id === currentUserId;
              const busy = busyId === u.id;
              return (
                <li key={u.id} className="space-y-3 p-4" data-testid={`user-${u.email}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`font-semibold ${u.isActive ? 'text-navy dark:text-slate-100' : 'text-gray-400 line-through'}`}>
                        {u.name} {self && <span className={`text-xs font-normal ${muted}`}>(tú)</span>}
                      </p>
                      <p className={`truncate text-xs ${muted}`}>
                        {u.email} · {u.lastLoginAt ? `último ingreso ${formatDateTime(u.lastLoginAt)}` : 'sin ingresos'}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold">
                        <span className={`rounded-full px-2 py-0.5 ${u.isActive ? 'bg-green-50 text-green-800 ring-1 ring-green-200' : 'bg-gray-100 text-gray-600'}`}>
                          {u.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                        {u.isTwoFactorEnabled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf8ec] px-2 py-0.5 text-gold-700 ring-1 ring-gold/40">
                            <ShieldCheck className="h-3 w-3" /> 2FA
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`role-${u.id}`} className="sr-only">
                        Rol de {u.name}
                      </label>
                      <select
                        id={`role-${u.id}`}
                        value={u.role}
                        disabled={busy}
                        onChange={(e) =>
                          void act(
                            u.id,
                            () => apiJson(`/users/${u.id}`, { method: 'PATCH', body: json({ role: e.target.value }) }, 'No se pudo cambiar el rol'),
                            `${u.name} ahora es ${ROLE_LABELS[e.target.value as UserRole]}.`,
                          )
                        }
                        className={`${input} w-auto`}
                      >
                        <option value="ASESOR">{ROLE_LABELS.ASESOR}</option>
                        <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                      </select>
                      {!self && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              u.id,
                              () => apiJson(`/users/${u.id}/status`, { method: 'PATCH', body: json({ isActive: !u.isActive }) }, 'No se pudo cambiar el acceso'),
                              u.isActive ? `${u.name} ya no puede ingresar.` : `${u.name} puede ingresar de nuevo.`,
                            )
                          }
                          className={btnSecondary}
                        >
                          {u.isActive ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                      {!self && (
                        <button type="button" disabled={busy} onClick={() => setResetFor({ id: u.id, password: '' })} className={btnSecondary}>
                          <KeyRound className="h-4 w-4" /> Contraseña
                        </button>
                      )}
                    </div>
                  </div>
                  {resetFor?.id === u.id && (
                    <form onSubmit={resetPassword} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-end dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex-1">
                        <label htmlFor={`reset-${u.id}`} className={label}>
                          Nueva contraseña para {u.name} (mín. 10 caracteres)
                        </label>
                        <input
                          id={`reset-${u.id}`}
                          type="password"
                          autoComplete="new-password"
                          minLength={10}
                          maxLength={72}
                          required
                          value={resetFor.password}
                          onChange={(e) => setResetFor({ id: u.id, password: e.target.value })}
                          className={input}
                        />
                      </div>
                      <button type="submit" disabled={busy || resetFor.password.length < 10} className={btnPrimary}>
                        Restablecer
                      </button>
                      <button type="button" onClick={() => setResetFor(null)} className={btnSecondary}>
                        Cancelar
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form onSubmit={create} className={`${card} grid gap-3 p-5 md:grid-cols-2`}>
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy md:col-span-2 dark:text-slate-100">
          <UserPlus className="h-4 w-4 text-gold-700 dark:text-gold-400" /> Nuevo usuario
        </h3>
        <div>
          <label htmlFor="new-name" className={label}>
            Nombre completo
          </label>
          <input id="new-name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="new-email" className={label}>
            Correo
          </label>
          <input id="new-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="new-password" className={label}>
            Contraseña inicial (mín. 10 caracteres)
          </label>
          <input id="new-password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input} />
        </div>
        <div>
          <label htmlFor="new-role" className={label}>
            Rol
          </label>
          <select id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} className={input}>
            <option value="ASESOR">{ROLE_LABELS.ASESOR}</option>
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <button type="submit" disabled={creating} className={btnPrimary}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" />} Crear usuario
          </button>
        </div>
      </form>
    </div>
  );
}
