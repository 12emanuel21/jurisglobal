'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { LoginError, useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { BrandMark } from '@/components/layout/BrandMark';
import { PANEL_HOME } from '@/lib/roles';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? undefined;
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    if (!authLoading && isAuthenticated) router.replace(PANEL_HOME);
  }, [authLoading, isAuthenticated, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password, needsCode ? totpCode : undefined, next);
    } catch (err) {
      if (err instanceof LoginError && err.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsCode(true);
        setTotpCode('');
        return;
      }
      if (err instanceof LoginError && err.code === 'TWO_FACTOR_INVALID') setTotpCode('');
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'tap w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition-colors focus:border-amber-500';

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <p className="text-sm text-slate-400">Panel de administración</p>
        </div>
        {error && (
          <div role="alert" className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-center text-sm font-semibold text-rose-400">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="email" className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Correo electrónico</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={needsCode} className={input} />
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Contraseña</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required readOnly={needsCode} className={input} />
          </div>
          {needsCode && (
            <div>
              <label htmlFor="totp" className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Código de verificación</label>
              <input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={7}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/[^\d\s]/g, ''))}
                placeholder="123 456"
                required
                className={`${input} text-center font-mono text-lg tracking-[0.3em]`}
              />
              <p className="mt-2 text-xs text-slate-400">Escribe el código de 6 dígitos de tu app de autenticación.</p>
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="tap flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {needsCode ? 'Verificar código' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
