import { normalizeHeader } from '../contacts/contacts-spreadsheet';

/**
 * Reglas de plantillas de Meta para masivos: variables posicionales ({{1}}, {{2}}…), detección de
 * la opción de baja (obligatoria, ESP §7.2 y Ley 2300 art. 5 par. 2), mapeo de variables a datos
 * del contacto y lectura de lo que devuelve Graph (/message_templates).
 */
export type ButtonRole = 'OPT_OUT' | 'OPT_IN_ACCEPT' | 'OTHER';
export interface TemplateButton {
  text: string;
  role: ButtonRole;
}
export type VariableSource = 'firstName' | 'fullName' | 'literal';
export interface VariableRule {
  type: VariableSource;
  /** literal: el texto; firstName/fullName: respaldo si el contacto no tiene nombre */
  value?: string;
}
export type VariableMapping = Record<string, VariableRule>;

export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LANGUAGE_PATTERN = /^[a-z]{2}(_[A-Z]{2})?$/;
export const DEFAULT_NAME_FALLBACK = 'cliente';

/** Números de variable usados en el cuerpo, ordenados y sin repetir */
export function bodyVariables(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** Cantidad de variables; lanza si no son consecutivas desde 1 (Meta lo exige) */
export function countVariables(body: string): number {
  const vars = bodyVariables(body);
  vars.forEach((n, i) => {
    if (n !== i + 1) throw new Error('Las variables deben ser consecutivas desde {{1}} ({{1}}, {{2}}…)');
  });
  return vars.length;
}

const OPT_OUT_HINTS = [
  'no acepto',
  'stop',
  'baja',
  'darme de baja',
  'no recibir',
  'no deseo recibir',
  'no quiero recibir',
  'dejar de recibir',
  'cancelar suscripcion',
  'no me interesa',
  'no, gracias',
  'no gracias',
  'unsubscribe',
];
const ACCEPT_HINTS = [
  'acepto',
  'si acepto',
  'si, acepto',
  'autorizo',
  'si autorizo',
  'si, quiero',
  'si quiero',
  'quiero recibir',
];

/** Rol sugerido para un botón de respuesta rápida según su texto */
export function guessButtonRole(text: string): ButtonRole {
  const t = normalizeHeader(text)
    .replace(/[¡!¿?.]/g, '')
    .trim();
  if (OPT_OUT_HINTS.some((h) => t === h || t.includes(h))) return 'OPT_OUT';
  if (ACCEPT_HINTS.some((h) => t === h || t.startsWith(h))) return 'OPT_IN_ACCEPT';
  return 'OTHER';
}

/** ¿El pie de página explica cómo darse de baja? (p. ej. "Responde STOP para no recibir más") */
export function footerHasOptOut(footer: string | null | undefined): boolean {
  if (!footer) return false;
  const t = normalizeHeader(footer);
  return /\b(stop|baja|no recibir|dejar de recibir|cancelar)\b/.test(t);
}

export function hasOptOutOption(footer: string | null | undefined, buttons: TemplateButton[]): boolean {
  return buttons.some((b) => b.role === 'OPT_OUT') || footerHasOptOut(footer);
}

/** Motivos por los que una plantilla no se puede usar para lanzar (vacío = apta) */
export function templateLaunchProblems(t: {
  status: string;
  hasOptOut: boolean;
  purpose: 'MARKETING' | 'OPT_IN';
  buttons: TemplateButton[];
}): string[] {
  const problems: string[] = [];
  if (t.status !== 'APPROVED') problems.push('La plantilla no está aprobada en Meta');
  if (!t.hasOptOut) problems.push('La plantilla no tiene opción de baja (botón o pie con STOP/baja)');
  if (t.purpose === 'OPT_IN' && !t.buttons.some((b) => b.role === 'OPT_IN_ACCEPT'))
    problems.push('La plantilla de confirmación necesita un botón para aceptar (rol «Acepta»)');
  return problems;
}

/** Meta rechaza parámetros con saltos de línea, tabulaciones o más de 4 espacios seguidos */
const cleanParam = (value: string) =>
  value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 200);

/** Parámetros del cuerpo para un contacto, en orden ({{1}}…{{n}}) */
export function resolveVariables(
  mapping: VariableMapping,
  variableCount: number,
  contact: { name: string | null },
): string[] {
  const fullName = contact.name?.trim() || '';
  const firstName = fullName.split(/\s+/)[0] ?? '';
  return Array.from({ length: variableCount }, (_, i) => {
    const rule = mapping[String(i + 1)] ?? { type: 'firstName' as const };
    if (rule.type === 'literal') return cleanParam(rule.value ?? '') || '-';
    const value = rule.type === 'fullName' ? fullName : firstName;
    return cleanParam(value) || cleanParam(rule.value ?? '') || DEFAULT_NAME_FALLBACK;
  });
}

/** Valida el mapeo contra la plantilla; devuelve el mapeo normalizado */
export function normalizeMapping(raw: unknown, variableCount: number): VariableMapping {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: VariableMapping = {};
  for (let i = 1; i <= variableCount; i++) {
    const rule = (input[String(i)] ?? { type: i === 1 ? 'firstName' : 'literal' }) as Partial<VariableRule>;
    const type: VariableSource =
      rule.type === 'fullName' || rule.type === 'literal' || rule.type === 'firstName' ? rule.type : 'literal';
    const value = typeof rule.value === 'string' ? rule.value.trim().slice(0, 200) : '';
    if (type === 'literal' && !value) throw new Error(`Escribe el texto para la variable {{${i}}}`);
    out[String(i)] = { type, ...(value ? { value } : {}) };
  }
  return out;
}

/** Texto final del cuerpo con los parámetros (vista previa e historial del Inbox) */
export function renderBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}

/** Plantilla tal como la devuelve Graph GET /{waba}/message_templates */
export interface GraphTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components?: Array<{ type: string; text?: string; buttons?: Array<{ type: string; text?: string }> }>;
}

export function parseGraphTemplate(t: GraphTemplate) {
  const components = Array.isArray(t.components) ? t.components : [];
  const body = components.find((c) => c.type === 'BODY')?.text ?? '';
  const footer = components.find((c) => c.type === 'FOOTER')?.text ?? null;
  const buttons: TemplateButton[] = (components.find((c) => c.type === 'BUTTONS')?.buttons ?? [])
    .filter((b) => b.type === 'QUICK_REPLY' && typeof b.text === 'string')
    .map((b) => ({ text: b.text!, role: guessButtonRole(b.text!) }));
  let variableCount = 0;
  try {
    variableCount = countVariables(body);
  } catch {
    variableCount = bodyVariables(body).length;
  }
  return {
    metaId: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    components,
    bodyText: body,
    footerText: footer,
    buttons,
    variableCount,
    hasOptOut: hasOptOutOption(footer, buttons),
  };
}
