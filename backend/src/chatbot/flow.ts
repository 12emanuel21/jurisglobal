import { isEmail } from 'class-validator';
import { toColombianPhone } from '../common/phone';

/**
 * Lógica pura del chatbot (sin BD ni red): estados, comandos y validación de lo que escribe la
 * persona. El servicio (chatbot.service.ts) decide qué enviar y persiste el estado.
 *
 *   IDLE → ASK_CONSENT → ASK_NAME → ASK_EMAIL → (ASK_PHONE) → ASK_MOTIVO → DONE
 *   ASK_CONSENT + «No acepto» → IDLE (sin lead) · STOP en cualquier paso → OPTED_OUT
 *
 * El saludo pide el nombre completo y la consulta: si la persona los escribe antes de tocar
 * «Acepto», se guardan en la sesión y, tras autorizar, el bot salta directo al correo.
 * Sesión: tras SESSION_TTL_MS sin mensajes, la conversación vuelve a empezar (patrón de KovalCloud:
 * el historial sigue en el Inbox, solo se descarta el estado y los datos temporales).
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
  /** Lo que la persona contó que necesita (va como nota del lead) */
  need?: string;
}

/**
 * Sesión del bot: tras 15 minutos sin mensajes (de nadie: persona, bot, asesor o campaña), quien
 * vuelve a escribir empieza de cero con el saludo. La baja (OPTED_OUT) es permanente y no se reinicia.
 */
export const SESSION_TTL_MS = 15 * 60 * 1000;

/** ¿Venció la sesión? Más de `ttlMs` entre la última interacción y este mensaje */
export function isSessionExpired(previousAt: Date | null | undefined, now: Date, ttlMs = SESSION_TTL_MS): boolean {
  return Boolean(previousAt) && now.getTime() - previousAt!.getTime() > ttlMs;
}
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

/**
 * «Sí, soy Ana Pérez» / «Acepto. Me llamo…»: autorización escrita seguida de más texto. Devuelve la
 * respuesta del primer fragmento y el resto (para buscar el nombre). null si no empieza así.
 */
export function splitLeadingConsent(text: string): { answer: 'yes' | 'no'; rest: string } | null {
  const m = /^\s*([^,.;:\n!]+)[,.;:\n!]+\s*([\s\S]+)$/.exec(text);
  if (!m) return null;
  const answer = parseConsentAnswer(m[1], null);
  return answer ? { answer, rest: m[2].trim() } : null;
}

const QUESTION_START =
  /^(cuanto|cuanta|cuantos|cuantas|donde|como|que|cual|cuales|quien|quienes|cuando|por que|porque|para que|puedo|pueden|podrian|podria|me pueden|me podrian|me ayudan|ayuda|necesito|quiero saber|quisiera saber|tengo una (pregunta|duda|consulta)|tienen|hacen|atienden|ofrecen|manejan|llevan|es posible|hay|cobran|aceptan|trabajan)\b/;

/** ¿Es una pregunta o una petición en lugar del dato que se pidió? */
export function looksLikeQuestion(text: string): boolean {
  if (/[¿?]/.test(text)) return true;
  return QUESTION_START.test(normalizeText(text));
}

const DIRECT_QUESTION =
  /^(cuanto|cuanta|cuantos|cuantas|donde|como|que|cual|cuales|quien|quienes|cuando|por que|para que|puedo|pueden|podrian|podria|me pueden|me podrian|tienen|hacen|atienden|ofrecen|manejan|llevan|es posible|hay|cobran|aceptan|trabajan)\b/;

/**
 * Pregunta directa (para la IA): con signos de interrogación o empezando por cuánto, dónde, cómo…
 * «Necesito ayuda con un embargo» NO es una pregunta: es la consulta y se guarda.
 */
export function isDirectQuestion(text: string): boolean {
  return /[¿?]/.test(text) || DIRECT_QUESTION.test(normalizeText(text));
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

/** Saludos al inicio del mensaje ("Hola, buenas tardes.") */
const LEADING_GREETING =
  /^(hola+|holi|buen[oa]s?(\s+(d[ií]as|tardes|noches))?|buen\s+d[ií]a|saludos|qu[eé]\s+tal|cordial\s+saludo|muy\s+buen[oa]s?(\s+(d[ií]as|tardes|noches))?)(?=[\s,.!¡;:]|$)[\s,.!¡;:]*/i;
/** Presentación: "soy", "me llamo", "mi nombre es", "les habla"… */
const NAME_INTRO =
  /^(yo\s+)?(me\s+llamo|mi\s+nombre\s+(completo\s+)?es|soy|habla|le[s]?\s+habla|te\s+habla|le[s]?\s+escribe|te\s+escribe|nombre\s*:)\s*/i;
/** Palabras con las que empieza la consulta: aquí termina el nombre */
const NEED_START = new Set([
  'necesito',
  'necesitaria',
  'quiero',
  'quisiera',
  'queria',
  'tengo',
  'tenemos',
  'me',
  'mi',
  'mis',
  'nos',
  'estoy',
  'estamos',
  'busco',
  'buscamos',
  'requiero',
  'deseo',
  'solicito',
  'para',
  'por',
  'porque',
  'sobre',
  'con',
  'que',
  'es',
  'un',
  'una',
  'el',
  'en',
  'ayuda',
  'consulta',
  'y',
  'e',
  'tema',
  'caso',
  'le',
  'les',
  'te',
  'vengo',
  'escribo',
  'llamo',
]);
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los']);
const NAME_TOKEN = /^\p{L}[\p{L}'-]*$/u;

/**
 * Nombre y consulta en un mismo mensaje (respuesta al saludo):
 *   "Ana María Pérez" → nombre · "Soy Ana Pérez y necesito ayuda con un embargo" → nombre + consulta
 *   "Hola, mi nombre es Carlos Gómez, me embargaron la cuenta" → nombre + consulta
 *   "Necesito ayuda con Datacrédito" → solo consulta.
 * Con `requireIntro` solo se toma el nombre si hay una presentación explícita ("soy", "me llamo"),
 * para no confundir un primer «Hola, buenas tardes» con un nombre.
 */
export function parseNameAndNeed(
  text: string,
  opts: { requireIntro?: boolean } = {},
): { name: string | null; need: string | null } {
  let rest = (text ?? '').replace(/[ \t]+/g, ' ').trim();
  for (let i = 0; i < 3 && LEADING_GREETING.test(rest); i++) rest = rest.replace(LEADING_GREETING, '').trim();
  const intro = NAME_INTRO.exec(rest);
  if (intro) rest = rest.slice(intro[0].length).trim();
  const cleanNeed = (value: string) => {
    const need = value
      .replace(/^[\s,.;:!¡\-–—]+/, '')
      .replace(/^(y|e)\s+/i, '')
      .trim();
    // Una consulta tiene al menos 3 palabras o un término del tema («embargo», «deuda»…): «de nuevo» no lo es
    const form = normalizeText(need);
    return form.split(' ').filter(Boolean).length >= 3 || NOT_A_NAME.test(form) ? need.slice(0, 500) : null;
  };
  if (!rest) return { name: null, need: null };
  if (opts.requireIntro && !intro) return { name: null, need: cleanNeed(rest) };

  // El nombre llega hasta el primer signo, salto de línea o palabra de consulta
  const boundary = /[\n,.;:!¿?()]|\s[-–—]\s/.exec(rest);
  const segment = boundary ? rest.slice(0, boundary.index) : rest;
  const words = segment.split(' ').filter(Boolean);
  const nameWords: string[] = [];
  for (const w of words) {
    const form = normalizeText(w);
    if (NEED_START.has(form) || !NAME_TOKEN.test(w)) break;
    nameWords.push(w);
  }
  while (nameWords.length && NAME_PARTICLES.has(normalizeText(nameWords[nameWords.length - 1]))) nameWords.pop();
  // Un nombre no empieza por «de», «la»… («Hola de nuevo» no es un nombre)
  if (nameWords.length && NAME_PARTICLES.has(normalizeText(nameWords[0]))) nameWords.length = 0;
  const candidate = nameWords.join(' ');
  const name =
    candidate && nameWords.length <= 6 && !NOT_A_NAME.test(normalizeText(candidate)) ? parseFullName(candidate) : null;
  if (!name) return { name: null, need: cleanNeed(rest) };
  // Las palabras del segmento van separadas por un espacio: el nombre es un prefijo exacto
  return { name, need: cleanNeed(rest.slice(candidate.length)) };
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
