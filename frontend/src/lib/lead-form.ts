/** Validación del formulario unificado en el navegador (misma regla que el backend, ESP §5) */

export interface LeadFormValues {
  fullName: string;
  phone: string;
  email: string;
  /** id del motivo (de GET /api/public/config) */
  motivo: string;
  privacyAndTerms: boolean;
  contactAndDataProcessing: boolean;
  /** Honeypot: campo oculto, debe quedar vacío */
  website: string;
}

export type LeadFormErrors = Partial<Record<keyof LeadFormValues, string>>;

export const EMPTY_LEAD_FORM: LeadFormValues = {
  fullName: '',
  phone: '',
  email: '',
  motivo: '',
  privacyAndTerms: false,
  contactAndDataProcessing: false,
  website: '',
};

const NAME = /^[\p{L}][\p{L} .'-]*$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Número nacional de 10 dígitos (celular 3xx o fijo 60x) o null. Acepta el indicativo 57 o un 0
 * inicial: "+57 300 123 4567", "300-123-4567", "0300 123 4567" -> "3001234567".
 */
export function normalizeColombianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('57')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^(3\d{9}|60\d{8})$/.test(digits) ? digits : null;
}

export const cleanName = (value: string) => value.replace(/\s+/g, ' ').trim();

export function validateLeadForm(values: LeadFormValues): LeadFormErrors {
  const errors: LeadFormErrors = {};
  const name = cleanName(values.fullName);
  if (!name) errors.fullName = 'Escribe tu nombre completo.';
  else if (name.length < 3 || !NAME.test(name)) errors.fullName = 'Usa solo letras y espacios (mínimo 3 caracteres).';

  if (!values.phone.trim()) errors.phone = 'Escribe tu número de teléfono.';
  else if (!normalizeColombianPhone(values.phone)) {
    errors.phone = 'Ingresa un celular (3xx) o fijo (60x) de Colombia de 10 dígitos.';
  }

  if (!values.email.trim()) errors.email = 'Escribe tu correo electrónico.';
  else if (!EMAIL.test(values.email.trim())) errors.email = 'Revisa el formato del correo (ejemplo: nombre@correo.com).';

  if (!values.motivo) errors.motivo = 'Selecciona el motivo de tu consulta.';
  if (!values.privacyAndTerms) errors.privacyAndTerms = 'Debes aceptar para continuar.';
  if (!values.contactAndDataProcessing) errors.contactAndDataProcessing = 'Debes autorizar para continuar.';
  return errors;
}

/** Cuerpo de POST /api/leads (origin "web" y honeypot incluido, vacío si es una persona) */
export function toLeadPayload(values: LeadFormValues) {
  return {
    fullName: cleanName(values.fullName),
    phone: `+57${normalizeColombianPhone(values.phone) ?? ''}`,
    email: values.email.trim().toLowerCase(),
    motivo: values.motivo,
    origin: 'web' as const,
    privacyAndTerms: values.privacyAndTerms,
    contactAndDataProcessing: values.contactAndDataProcessing,
    website: values.website,
  };
}
