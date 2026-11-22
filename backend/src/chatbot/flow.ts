import { isEmail } from 'class-validator';
import { toColombianPhone } from '../common/phone';

/**
 * Lógica pura del chatbot (sin BD ni red): estados, comandos y validación de lo que escribe la
 * persona. El servicio (chatbot.service.ts) decide qué enviar y persiste el estado.
 *
 *   IDLE → ASK_CONSENT → ASK_NAME → ASK_EMAIL → (ASK_PHONE) → ASK_MOTIVO → DONE
 *   ASK_CONSENT + «No acepto» → IDLE (sin lead) · STOP en cualquier paso → OPTED_OUT
 *
 * ASK_PHONE solo aparece si el número de WhatsApp no es de Colombia (el lead exige un número
 * colombiano para que el asesor pueda llamar).
 */
export const FLOW_STATES = [
  'IDLE',
  'ASK_CONSENT',
  'ASK_NAME',
  'ASK_EMAIL',
  'ASK_PHONE',
  'ASK_MOTIVO',
  'DONE',
  'OPTED_OUT',
] as const;
export type FlowState = (typeof FLOW_STATES)[number];

export interface FlowData {
  /** Consent registrado al tocar «Acepto» (se enlaza al lead al final) */
  consentId?: string;
  fullName?: string;
  email?: string;
  /** Solo si el WhatsApp no es colombiano */
  phone?: string;
  leadId?: string;
  /** Respuestas de la IA en esta sesión (tope anti-abuso) */
  aiAnswers?: number;
  /** En DONE: ya se recordó una vez que los datos están registrados */
  doneReminded?: boolean;
}

/** Sin mensajes durante este tiempo, la conversación vuelve a empezar (salvo la baja, que es permanente) */
export const FLOW_RESET_MS = 24 * 60 * 60 * 1000;
/** Respuestas de Gemini por sesión; después se usan las respuestas fijas */
export const MAX_AI_ANSWERS_PER_SESSION = 6;

export const CONSENT_YES_ID = 'consent:yes';
export const CONSENT_NO_ID = 'consent:no';
export const MOTIVO_ID_PREFIX = 'motivo:';

export function parseFlowState(value: string | null | undefined): FlowState {
  return (FLOW_STATES as readonly string[]).includes(value ?? '') ? (value as FlowState) : 'IDLE';
}

/** Minúsculas, sin tildes ni signos y con espacios simples: "¡NO quiero MÁS mensajes!" -> "no quiero mas mensajes" */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Muletillas que no cambian el sentido de un comando ("STOP por favor", "baja gracias") */
const FILLER = /\b(por favor|porfavor|porfa|gracias|ya|ok|okay)\b/g;

const commandForm = (text: string) => normalizeText(text).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();

/**
 * ¿Pide la baja? Solo expresiones inequívocas y como mensaje completo: "STOP", "BAJA",
 * "NO QUIERO MÁS MENSAJES". "No quiero que me embarguen" NO es una baja.
 */
export function isStopCommand(text: string, keywords: readonly string[]): boolean {
  const form = commandForm(text);
  return Boolean(form) && keywords.some((k) => commandForm(k) === form);
}

const RESTART = new Set([
  'inicio',
  'iniciar',
  'reiniciar',
  'reinicio',
  'empezar',
  'empezar de nuevo',
  'volver a empezar',
]);

/** "reiniciar" / "inicio": empieza de cero (también reactiva el bot tras una baja) */
export function isRestartCommand(text: string): boolean {
  return RESTART.has(commandForm(text));
}

const CONSENT_YES = new Set(['acepto', 'si acepto', 'si', 'si autorizo', 'autorizo', 'acepto y autorizo', 'aceptar']);
const CONSENT_NO = new Set(['no acepto', 'no', 'no autorizo', 'no gracias', 'rechazo', 'no aceptar']);

/** Respuesta a la autorización: botón (id) o texto inequívoco escrito */
export function parseConsentAnswer(text: string, interactiveId: string | null): 'yes' | 'no' | null {
  if (interactiveId === CONSENT_YES_ID) return 'yes';
  if (interactiveId === CONSENT_NO_ID) return 'no';
  if (interactiveId) return null;
  const form = normalizeText(text).replace(/\s+(gracias|por favor)$/, '');
  if (CONSENT_YES.has(form)) return 'yes';
  if (CONSENT_NO.has(form)) return 'no';
  return null;
}

const QUESTION_START =
  /^(cuanto|cuanta|cuantos|cuantas|donde|como|que|cual|cuales|quien|quienes|cuando|por que|porque|para que|puedo|pueden|podrian|podria|me pueden|me podrian|me ayudan|ayuda|necesito|quiero saber|quisiera saber|tengo una (pregunta|duda|consulta)|tienen|hacen|atienden|ofrecen|manejan|llevan|es posible|hay|cobran|aceptan|trabajan)\b/;

/** ¿Es una pregunta o una petición en lugar del dato que se pidió? */
export function looksLikeQuestion(text: string): boolean {
  if (/[¿?]/.test(text)) return true;
  return QUESTION_START.test(normalizeText(text));
}

/** Palabras que delatan una petición, no un nombre ("Me ayudan con un embargo") */
const NOT_A_NAME =
  /\b(ayuda|ayudar|ayudan|embargo|embargado|embargaron|deuda|deudas|multa|multas|comparendo|fotomulta|precio|costo|cuesta|consulta|asesoria|abogado|abogada|informacion|info|ubicados|direccion|oficina|quiero|necesito|tengo|pueden|puedo|cobro|reporte|datacredito|banco|correo|email|telefono)\b/;
/** Saludos y respuestas sueltas que no son un nombre */
const NOT_A_NAME_ALONE = new Set([
  'hola',
  'buenas',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'gracias',
  'ok',
  'si',
  'no',
  'acepto',
  'no acepto',
  'listo',
  'dale',
  'hola buenas',
  'hola buenos dias',
  'hola buenas tardes',
  'hola buenas noches',
]);

/** ¿El texto pide algo (pregunta o petición) en lugar de dar el nombre? */
export function isRequestInsteadOfName(text: string): boolean {
  return looksLikeQuestion(text) || NOT_A_NAME.test(normalizeText(text));
}

const NAME_PREFIX = /^(hola[,.!\s]+)?(me llamo|mi nombre es|mi nombre completo es|soy|nombre\s*:)\s+/i;
const NAME_PATTERN = /^[\p{L}][\p{L} .'-]*$/u;
const LOWER_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

const titleCase = (name: string) =>
  name
    .toLocaleLowerCase('es-CO')
    .split(' ')
    .map((w, i) => (i > 0 && LOWER_PARTICLES.has(w) ? w : w.charAt(0).toLocaleUpperCase('es-CO') + w.slice(1)))
    .join(' ');

/**
 * Nombre completo o null. Acepta "Me llamo Ana María Pérez", quita signos finales y, si viene todo
 * en minúsculas o mayúsculas, lo capitaliza. Rechaza vacío, números, símbolos y saludos sueltos.
 */
export function parseFullName(text: string): string | null {
  let name = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(NAME_PREFIX, '')
    .replace(/[.!,;:]+$/, '')
    .trim();
  if (name.length < 3 || name.length > 120 || !NAME_PATTERN.test(name)) return null;
  const words = name.split(' ');
  if (words.length > 6 || NOT_A_NAME_ALONE.has(normalizeText(name))) return null;
  if (name === name.toLocaleLowerCase('es-CO') || name === name.toLocaleUpperCase('es-CO')) name = titleCase(name);
  return name;
}

/** Correo válido dentro del texto ("mi correo es Ana@Correo.co") o null */
export function extractEmail(text: string): string | null {
  const candidates = text.match(/[^\s<>()[\]"',;:¿?¡!]+@[^\s<>()[\]"',;:¿?¡!]+/g) ?? [];
  for (const raw of candidates) {
    const email = raw.replace(/[.]+$/, '').toLowerCase();
    if (email.length <= 254 && isEmail(email)) return email;
  }
  return null;
}

/** Teléfono colombiano escrito por la persona (ASK_PHONE) */
export function extractColombianPhone(text: string): string | null {
  const digits = text.replace(/[^\d+]/g, '');
  return toColombianPhone(digits);
}

export interface MotivoOption {
  id: string;
  name: string;
}

/**
 * Motivo elegido: id del botón/lista, número de la opción ("2", "opción 2") o nombre (sin tildes
 * ni mayúsculas). null si no se reconoce o es ambiguo.
 */
export function matchMotivo(text: string, interactiveId: string | null, motivos: MotivoOption[]): MotivoOption | null {
  if (interactiveId?.startsWith(MOTIVO_ID_PREFIX)) {
    const id = interactiveId.slice(MOTIVO_ID_PREFIX.length);
    return motivos.find((m) => m.id === id) ?? null;
  }
  if (interactiveId) return null;
  const form = normalizeText(text);
  const number = /^(?:(?:la\s+)?opcion\s+|la\s+|el\s+|numero\s+)?(\d{1,2})$/.exec(form);
  if (number) return motivos[Number(number[1]) - 1] ?? null;
  const exact = motivos.find((m) => normalizeText(m.name) === form);
  if (exact) return exact;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentioned = motivos.filter((m) => new RegExp(`\\b${escape(normalizeText(m.name))}\\b`).test(form));
  return mentioned.length === 1 ? mentioned[0] : null;
}

/** 100000 -> "$100.000 COP" (mismo formato que la web) */
export function formatCop(value: number): string {
  return `$${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} COP`;
}

/** Precio visible de la asesoría inicial o null (interruptor apagado o sin valor) */
export function visibleConsultationPrice(show: boolean, price: number | null): string | null {
  return show && typeof price === 'number' && Number.isFinite(price) && price > 0 ? formatCop(price) : null;
}

/** Frases que el bot nunca debe decir aunque las produzca la IA */
const FORBIDDEN_IN_AI_REPLY =
  /\b(gratis|gratuit[ao]s?|sin costo|garantiz\w*|te aseguro|le aseguro|aseguramos|eliminamos|borramos|detenemos|levantamos el embargo|ganaremos|vas a ganar)\b/i;

/**
 * Limpia la respuesta de la IA: máximo 2 frases cortas y nada prohibido. null = usar la respuesta
 * fija (el bot nunca reenvía algo dudoso).
 */
export function sanitizeAiReply(reply: string | null | undefined, maxLength = 320): string | null {
  const text = (reply ?? '').replace(/\s+/g, ' ').trim();
  if (!text || FORBIDDEN_IN_AI_REPLY.test(normalizeText(text))) return null;
  // Fin de frase = signo seguido de espacio ("$100.000 COP." no se parte en el punto de miles)
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = sentences
    .slice(0, 2)
    .map((x) => x.trim())
    .join(' ');
  if (out.length > maxLength) out = `${out.slice(0, maxLength - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

const PRICE_QUESTION = /\b(cuanto (cuesta|vale|cobran|es)|precio|costo|valor|tarifa|honorarios|cobran|pagar|pago)\b/;
const LOCATION_QUESTION = /\b(donde|ubicad\w*|direccion|oficina|sede|presencial|ciudad|barranquilla)\b/;

/**
 * Respuesta fija y segura cuando Gemini falla, tarda o se agotó el tope: precio y ubicación con
 * datos reales; el resto, al asesor. Nunca dice "gratis".
 */
export function fallbackAnswer(question: string, price: string | null): string {
  const q = normalizeText(question);
  if (PRICE_QUESTION.test(q)) {
    return price
      ? `La asesoría inicial tiene un valor de ${price}.`
      : 'Un asesor te confirmará las condiciones de la asesoría inicial en el primer contacto.';
  }
  if (LOCATION_QUESTION.test(q)) {
    return 'Estamos en Barranquilla: atendemos de forma virtual y presencial, con cobertura en todo el país.';
  }
  return 'Esa inquietud la revisará un asesor de JurisGlobal cuando se comunique contigo; por este chat no damos asesoría jurídica.';
}
