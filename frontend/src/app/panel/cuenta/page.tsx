'use client';

import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { SudoCancelledError, useSudoMode } from '@/context/SudoContext';
import { TwoFactorSetup } from '@/components/security/TwoFactorSetup';
import { apiErrorMessage } from '@/lib/api';

/** Mi cuenta: verificación en 2 pasos y cambio de contraseña (adaptado de MyAccountSection/TwoFactorSection) */
export default function AccountPage() {
  const { user, refreshProfile } = useAuth();
  const { sudoFetch } = useSudoMode();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await sudoFetch('/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ ...(current ? { currentPassword: current } : {}), newPassword: next }),
      });
      if (!res.ok) throw new Error((await apiErrorMessage(res, 'No se pudo cambiar la contraseña')).message);
      setCurrent('');
      setNext('');
      setFeedback({ ok: true, text: 'Contraseña actualizada. Las demás sesiones se cerraron.' });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof SudoCancelledError || err instanceof Error ? err.message : 'Error' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'tap w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-amber-500';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
          <ShieldCheck className="h-4 w-4 text-amber-400" /> Verificación en 2 pasos
        </h2>
        {user?.isTwoFactorEnabled ? (
          <p className="flex items-center gap-2 text-sm text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-green-400" /> Activa. Se pedirá un código al iniciar sesión y en acciones sensibles.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-400">Protege el acceso a los datos personales de los leads con una app de autenticación (Google Authenticator o Authy).</p>
            <TwoFactorSetup onEnabled={() => refreshProfile()} />
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-100">
          <KeyRound className="h-4 w-4 text-blue-400" /> Cambiar contraseña
        </h2>
        <form onSubmit={changePassword} className="space-y-3">
          <input type="password" autoComplete="current-password" placeholder={user?.isTwoFactorEnabled ? 'Contraseña actual (o confirma con tu código)' : 'Contraseña actual'} value={current} onChange={(e) => setCurrent(e.target.value)} required={!user?.isTwoFactorEnabled} className={input} />
          <input type="password" autoComplete="new-password" placeholder="Nueva contraseña (mín. 10 caracteres)" minLength={10} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} required className={input} />
          <button type="submit" disabled={busy} className="tap inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </button>
          {feedback && <p className={`text-xs ${feedback.ok ? 'text-green-400' : 'text-rose-400'}`}>{feedback.text}</p>}
        </form>
      </section>
    </div>
  );
}
