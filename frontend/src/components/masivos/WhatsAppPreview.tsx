import { Fragment, type ReactNode } from 'react';
import { CheckCheck, ChevronLeft, Reply } from 'lucide-react';

/**
 * Vista previa tipo teléfono de un mensaje de plantilla de WhatsApp: encabezado, cuerpo con el
 * formato de WhatsApp (*negrita*, _cursiva_, ~tachado~, ```monoespaciado``` y saltos de línea), pie y
 * botones de respuesta rápida. Las variables {{n}} se reemplazan por `params`; las que no tienen
 * valor se resaltan para que se note qué falta. Se arma con nodos de React (nunca HTML crudo).
 */
interface Props {
  header?: string | null;
  body: string;
  footer?: string | null;
  buttons?: string[];
  /** Valores de {{1}}, {{2}}… */
  params?: Array<string | null | undefined>;
  /** Texto bajo el teléfono (p. ej. de dónde salen los datos de ejemplo) */
  caption?: ReactNode;
  className?: string;
}

const INLINE = /(\{\{\s*\d+\s*\}\}|```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/;

function formatInline(text: string, params: Props['params'], key: string): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== '');
  return parts.map((part, i) => {
    const k = `${key}-${i}`;
    const variable = part.match(/^\{\{\s*(\d+)\s*\}\}$/);
    if (variable) {
      const value = params?.[Number(variable[1]) - 1]?.trim();
      return value ? (
        <Fragment key={k}>{formatInline(value, undefined, k)}</Fragment>
      ) : (
        <mark key={k} data-testid="wa-missing-var" className="rounded bg-[#fde68a] px-1 font-mono text-[0.8em] text-[#78350f]">
          {`{{${variable[1]}}}`}
        </mark>
      );
    }
    if (part.startsWith('```') && part.endsWith('```') && part.length > 6)
      return (
        <code key={k} className="font-mono text-[0.85em]">
          {part.slice(3, -3)}
        </code>
      );
    const wrap = part[0];
    if (part.length > 2 && part.endsWith(wrap)) {
      const inner = formatInline(part.slice(1, -1), params, k);
      if (wrap === '*') return <strong key={k}>{inner}</strong>;
      if (wrap === '_') return <em key={k}>{inner}</em>;
      if (wrap === '~') return <s key={k}>{inner}</s>;
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

/** Texto con formato de WhatsApp → nodos de React (respeta los saltos de línea) */
export function formatWhatsApp(text: string, params?: Props['params']): ReactNode[] {
  return text.split('\n').map((line, i, lines) => (
    <Fragment key={i}>
      {formatInline(line, params, String(i))}
      {i < lines.length - 1 && <br />}
    </Fragment>
  ));
}

export function WhatsAppPreview({ header, body, footer, buttons = [], params, caption, className = '' }: Props) {
  const time = new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
  return (
    <figure aria-label="Vista previa en WhatsApp" className={`mx-auto w-full max-w-[300px] ${className}`}>
      <div className="overflow-hidden rounded-[2.2rem] border-[7px] border-[#1f2937] bg-[#1f2937] shadow-xl">
        {/* Barra superior de WhatsApp */}
        <div className="flex items-center gap-2 bg-[#075e54] px-3 pb-2 pt-3 text-[#fff]">
          <ChevronLeft className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
          {/* eslint-disable-next-line @next/next/no-img-element -- ícono decorativo pequeño, sin optimizar */}
          <img src="/brand/isotipo.png" alt="" className="h-8 w-8 shrink-0 rounded-full bg-[#fff] p-0.5" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">JurisGlobal</p>
            <p className="truncate text-[11px] opacity-80">Cuenta de empresa</p>
          </div>
        </div>
        {/* Conversación */}
        <div className="min-h-[300px] space-y-1 bg-[#efeae2] px-2.5 py-4 dark:bg-[#0b141a]">
          <div className="max-w-[92%] rounded-lg rounded-tl-none bg-[#fff] px-2.5 pb-1 pt-2 text-[13px] leading-snug text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
            {header && (
              <p className="mb-1 font-bold" data-testid="wa-header">
                {formatWhatsApp(header, params)}
              </p>
            )}
            <p data-testid="wa-body" className="break-words">
              {formatWhatsApp(body, params)}
            </p>
            {footer && (
              <p className="mt-1 text-[11px] text-[#667781] dark:text-[#8696a0]" data-testid="wa-footer">
                {footer}
              </p>
            )}
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781] dark:text-[#8696a0]">
              {time} <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" aria-hidden="true" />
            </p>
          </div>
          {buttons.length > 0 && (
            <ul className="max-w-[92%] space-y-1" aria-label="Botones de la plantilla">
              {buttons.map((b) => (
                <li
                  key={b}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-[#fff] py-2 text-[13px] font-medium text-[#027eb5] shadow-sm dark:bg-[#202c33] dark:text-[#53bdeb]"
                >
                  <Reply className="h-3.5 w-3.5" aria-hidden="true" /> {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {caption && <figcaption className="mt-2 text-center text-xs text-gray-600 dark:text-slate-400">{caption}</figcaption>}
    </figure>
  );
}
