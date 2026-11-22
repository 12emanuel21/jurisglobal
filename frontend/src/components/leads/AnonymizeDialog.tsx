'use client';

import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { btnDanger, btnSecondary, input } from '@/components/panel/ui';

export const ANONYMIZE_CONFIRMATION = 'ANONIMIZAR';

/**
 * Confirmación de la anonimización (Ley 1581): explica qué se borra y qué se conserva, y exige
 * escribir ANONIMIZAR (irreversible).
 */
export function AnonymizeDialog({
  leadName,
  onConfirm,
  onCancel,
}: {
  leadName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === ANONYMIZE_CONFIRMATION;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo anonimizar');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-gray-900/50 p-4 sm:items-center" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="anonymize-title"
        aria-describedby="anonymize-desc"
        className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-xl dark:border-red-900 dark:bg-slate-900"
      >
        <h2 id="anonymize-title" className="flex items-center gap-2 text-base font-bold text-red-800 dark:text-red-300">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" /> Anonimizar datos personales
        </h2>
        <div id="anonymize-desc" className="mt-3 space-y-2 text-sm text-gray-700 dark:text-slate-300">
          <p>
            Vas a anonimizar a <strong>{leadName}</strong> por solicitud del titular (Ley 1581 de 2012). <strong>No se puede deshacer.</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Se borran el nombre, el correo, el teléfono y el contenido de las notas.</li>
            <li>Se elimina su conversación de WhatsApp con sus adjuntos.</li>
            <li>Se conservan el estado, la huella del teléfono y el historial de autorizaciones, y queda excluido de todo envío.</li>
          </ul>
        </div>
        <label htmlFor="anonymize-confirm" className="mt-4 block text-xs font-semibold text-gray-700 dark:text-slate-300">
          Para confirmar escribe <span className="font-mono">{ANONYMIZE_CONFIRMATION}</span>
        </label>
        <input id="anonymize-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} mt-1 font-mono`} />
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>
            Cancelar
          </button>
          <button type="button" onClick={() => void confirm()} disabled={!ready || busy} className={btnDanger}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Anonimizar definitivamente
          </button>
        </div>
      </div>
    </div>
  );
}
