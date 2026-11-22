'use client';

import Link from 'next/link';
import { MessagesSquare, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/** Inicio del panel. Las métricas de leads y campañas llegan en las etapas 5 y 6. */
export default function PanelHome() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl font-bold text-slate-100">Hola, {user?.name.split(' ')[0]}</h2>
        <p className="text-sm text-slate-400">Centro de mando de JurisGlobal.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/panel/conversaciones" className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-600">
          <MessagesSquare className="mb-3 h-6 w-6 text-blue-400" />
          <p className="font-semibold text-slate-100">Conversaciones</p>
          <p className="text-xs text-slate-400">Chats de WhatsApp: responder, pausar el bot, audios y documentos.</p>
        </Link>
        <Link href="/panel/cuenta" className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-600">
          <ShieldCheck className="mb-3 h-6 w-6 text-amber-400" />
          <p className="font-semibold text-slate-100">Seguridad de tu cuenta</p>
          <p className="text-xs text-slate-400">
            {user?.isTwoFactorEnabled ? 'Verificación en 2 pasos activa.' : 'Activa la verificación en 2 pasos para proteger los datos.'}
          </p>
        </Link>
      </div>
    </div>
  );
}
