'use client';

import { useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { btnPrimary, btnSecondary, card, errorText, input, label, muted } from '@/components/panel/ui';
import { masivosApi, type ImportPreview, type ImportSummary } from '@/lib/masivos';

const COLUMN_LABEL: Array<[keyof ImportPreview['columns'], string, boolean]> = [
  ['phone', 'Teléfono', true],
  ['name', 'Nombre', false],
  ['source', 'Origen', true],
  ['consent', 'Autorización', true],
  ['email', 'Correo', false],
  ['tags', 'Etiquetas', false],
];

/** Botón «Descargar plantilla Excel (.xlsx)» (columnas exactas del importador) */
export function DownloadTemplateButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          masivosApi
            .downloadImportTemplate()
            .catch((err: unknown) => setError(errorText(err, 'No se pudo descargar la plantilla')))
            .finally(() => setBusy(false));
        }}
        className={btnSecondary}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar plantilla Excel (.xlsx)
      </button>
      {error && <span className="text-xs text-red-700 dark:text-red-300">{error}</span>}
    </span>
  );
}

/** Vista previa del archivo: columnas reconocidas, primera fila tal cual y cómo quedaría el contacto */
export function FilePreview({ preview }: { preview: ImportPreview }) {
  const first = preview.firstContact;
  return (
    <section aria-label="Vista previa del archivo" className="space-y-3 rounded-xl border border-gray-200 p-3 text-sm dark:border-slate-800">
      <p className="flex items-center gap-2 font-semibold text-navy dark:text-slate-100">
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> {preview.fileName}
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Columnas reconocidas">
        {COLUMN_LABEL.map(([key, text, required]) => {
          const found = preview.columns[key];
          if (!found && !required) return null;
          return (
            <li
              key={key}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                found ? 'bg-[#dcfce7] text-[#166534] dark:bg-[#14532d]/60 dark:text-[#bbf7d0]' : 'bg-[#fee2e2] text-[#991b1b] dark:bg-[#7f1d1d]/60 dark:text-[#fecaca]'
              }`}
            >
              {found ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              {text}
              {found && found !== text ? ` ← «${found}»` : ''}
              {!found && ' (falta)'}
            </li>
          );
        })}
      </ul>
      {preview.firstRow && (
        <div className="overflow-x-auto">
          <p className={`mb-1 text-xs font-semibold ${muted}`}>Primera fila de datos (tal como viene en el archivo)</p>
          <table className="min-w-full text-left text-xs" data-testid="first-row">
            <thead>
              <tr>
                {Object.keys(preview.firstRow).map((h) => (
                  <th key={h} scope="col" className="border-b border-gray-200 px-2 py-1 font-semibold dark:border-slate-700">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {Object.entries(preview.firstRow).map(([h, v]) => (
                  <td key={h} className="px-2 py-1">
                    {v || <span className={muted}>—</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {first && (
        <p data-testid="first-contact">
          Así quedaría (fila {first.row}): <strong>{first.name ?? 'Sin nombre'}</strong> · {first.phone} · Origen «{first.source}» ·{' '}
          {first.consent === 'DOCUMENTED' ? 'verificado (con soporte)' : 'no verificado'}
        </p>
      )}
      {!preview.error && (
        <p className={`text-xs ${muted}`} data-testid="preview-counts">
          {preview.validRows} contactos válidos ({preview.verified} verificados, {preview.unverified} no verificados) · {preview.invalidRows} filas
          inválidas · {preview.duplicateRows} repetidos en el archivo
        </p>
      )}
      {preview.errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-800 dark:text-red-300">
          {preview.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ImporterProps {
  onImported: (summary: ImportSummary, preview: ImportPreview | null) => void;
  /** Avisa la vista previa del archivo elegido (p. ej. para el teléfono de la campaña) */
  onPreview?: (preview: ImportPreview | null) => void;
  title?: string;
}

/**
 * Importador .xlsx/.csv en dos pasos: al elegir el archivo muestra la vista previa (columnas y
 * primera fila, sin guardar nada) y solo al confirmar importa. Columnas obligatorias: Teléfono,
 * Origen y Autorización. Con soporte documental («Sí») el contacto entra verificado; sin soporte,
 * solo podrá recibir la confirmación.
 */
export function ContactImporter({ onImported, onPreview, title = 'Importar contactos (Excel o CSV)' }: ImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const choose = async (next: File | null) => {
    setFile(next);
    setPreview(null);
    setSummary(null);
    setError(null);
    onPreview?.(null);
    if (!next) return;
    setReading(true);
    try {
      const p = await masivosApi.previewImport(next);
      setPreview(p);
      onPreview?.(p);
    } catch (err) {
      setError(errorText(err, 'No se pudo leer el archivo'));
    } finally {
      setReading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await masivosApi.importContacts(file, note);
      setSummary(result);
      onImported(result, preview);
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
            {title}
          </h3>
          <p className={`mt-1 max-w-prose text-xs ${muted}`}>
            Columnas obligatorias: <strong>Teléfono</strong>, <strong>Origen</strong> y <strong>Autorización</strong> (opcionales: Nombre, Correo,
            Etiquetas). Marca «Sí» en Autorización solo si hay soporte documental de que la persona autorizó a JurisGlobal: esos contactos quedan
            verificados para marketing. Los demás quedan «no verificados» y solo pueden recibir la campaña de confirmación.
          </p>
        </div>
        <DownloadTemplateButton />
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
            onChange={(e) => void choose(e.target.files?.[0] ?? null)}
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
        {reading && (
          <p className={`flex items-center gap-2 text-sm md:col-span-2 ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Leyendo el archivo…
          </p>
        )}
        {preview && (
          <div className="md:col-span-2">
            <FilePreview preview={preview} />
          </div>
        )}
        {preview?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300 md:col-span-2">
            {preview.error}
          </p>
        )}
        <div className="md:col-span-2">
          <button type="submit" disabled={!file || busy || reading || Boolean(preview?.error) || Boolean(summary)} className={btnPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {preview && !preview.error ? `Confirmar e importar ${preview.validRows} contactos` : 'Importar'}
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
