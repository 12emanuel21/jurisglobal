'use client';

import { useState } from 'react';
import { CheckCircle2, Download, Loader2, Upload } from 'lucide-react';
import { btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { IMPORT_TEMPLATE_CSV, masivosApi, type ImportSummary } from '@/lib/masivos';

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-contactos-jurisglobal.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Importador .xlsx/.csv. Columnas obligatorias: Teléfono, Origen y Autorización. Con soporte
 * documental ("Sí") el contacto entra verificado; sin soporte, solo podrá recibir la confirmación.
 */
export function ContactImporter({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      setSummary(await masivosApi.importContacts(file, note));
      onImported();
    } catch (err) {
      setError(errorText(err, 'No se pudo importar el archivo'));
    } finally {
      setBusy(false);
    }
  };

  const stat = (text: string, value: number, tone = 'text-navy dark:text-slate-100') => (
    <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
      <dt className={`text-xs font-semibold ${muted}`}>{text}</dt>
      <dd className={`font-serif text-2xl font-bold ${tone}`}>{value}</dd>
    </div>
  );

  return (
    <section aria-labelledby="importer-title" className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="importer-title" className="text-sm font-bold text-navy dark:text-slate-100">
            Importar contactos (Excel o CSV)
          </h3>
          <p className={`mt-1 max-w-prose text-xs ${muted}`}>
            Columnas obligatorias: <strong>Teléfono</strong>, <strong>Origen</strong> y <strong>Autorización</strong> (opcionales: Nombre, Correo,
            Etiquetas). Marca «Sí» en Autorización solo si hay soporte documental de que la persona autorizó a JurisGlobal: esos contactos quedan
            verificados para marketing. Los demás quedan «no verificados» y solo pueden recibir la campaña de confirmación.
          </p>
        </div>
        <button type="button" onClick={downloadTemplate} className={btnSecondary}>
          <Download className="h-4 w-4" /> Plantilla CSV
        </button>
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="import-file" className={label}>
            Archivo (.xlsx, .xls o .csv, máx. 5 MB)
          </label>
          <input
            id="import-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={`${input} py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-navy file:px-3 file:py-1 file:text-[#fff]`}
          />
        </div>
        <div>
          <label htmlFor="import-note" className={label}>
            Soporte documental de la base (opcional)
          </label>
          <input
            id="import-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Ej.: contrato con la consultoría, cláusula 7"
            className={input}
          />
        </div>
        <div className="md:col-span-2">
          <button type="submit" disabled={!file || busy} className={btnPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {summary && (
        <div role="status" aria-label="Resumen de la importación" className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-green-800 dark:text-green-300">
            <CheckCircle2 className="h-4 w-4" /> {summary.fileName}: {summary.totalRows} filas procesadas
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {stat('Importados', summary.imported, 'text-green-800 dark:text-green-300')}
            {stat('Actualizados', summary.updated)}
            {stat('Duplicados omitidos', summary.duplicates)}
            {stat('Filas inválidas', summary.invalid, summary.invalid ? 'text-red-700 dark:text-red-300' : undefined)}
            {stat('En baja (no se tocan)', summary.optedOutSkipped)}
            {stat('Verificados', summary.verified)}
            {stat('No verificados', summary.unverified)}
          </dl>
          <p className={`text-xs ${muted}`} data-testid="import-consent-split">
            De lo importado o actualizado: {summary.verified} verificados (aptos para marketing) y {summary.unverified} no verificados (solo
            confirmación). Duplicados: {summary.duplicatesInFile} repetidos en el archivo y {summary.duplicatesExisting} ya existentes sin cambios.
          </p>
          {summary.invalidDetails.length > 0 && (
            <details open className="rounded-xl border border-[#fecaca] p-3 text-sm dark:border-red-900">
              <summary className="cursor-pointer font-semibold text-red-800 dark:text-red-300">Filas inválidas</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-red-800 dark:text-red-300">
                {summary.invalidDetails.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          )}
          {summary.warnings.length > 0 && (
            <details className="rounded-xl border border-gray-200 p-3 text-sm dark:border-slate-800">
              <summary className="cursor-pointer font-semibold">Avisos ({summary.warnings.length})</summary>
              <ul className={`mt-2 list-disc space-y-1 pl-5 ${muted}`}>
                {summary.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
