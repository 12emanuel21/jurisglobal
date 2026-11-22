import { z } from 'zod';
import type { SettingKey } from '../../settings/defaults';

/** Frases que ningún texto del bot puede decir (mismo criterio que la IA: nunca "gratis" ni promesas) */
const FORBIDDEN_BOT_TEXT = /\b(gratis|gratuit[ao]s?|sin costo|garantiz\w*|te aseguro|eliminamos|detenemos)\b/i;

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** '' o espacios -> null (campos opcionales del formulario) */
const emptyToNull = (v: unknown) => (typeof v === 'string' && !v.trim() ? null : v);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Correo electrónico no válido' }).max(254));

const botText = (max: number) =>
  z
    .string()
    .trim()
    .min(10, { message: 'El texto es muy corto' })
    .max(max, { message: `Máximo ${max} caracteres` })
    .refine((t) => !FORBIDDEN_BOT_TEXT.test(plain(t)), {
      message: 'El texto no puede decir «gratis» ni prometer resultados',
    });

const intIn = (min: number, max: number, label: string) =>
  z
    .number({ message: `${label}: debe ser un número` })
    .int({ message: `${label}: debe ser un número entero` })
    .min(min, { message: `${label}: mínimo ${min}` })
    .max(max, { message: `${label}: máximo ${max}` });

/**
 * Parámetros que el ADMIN edita desde Configuración, con su validación. Lo que no está aquí (textos
 * de autorización, enlaces legales, palabras de baja) no se edita desde el panel: cambiarlos exige
 * revisión jurídica y subir la versión.
 */
export const EDITABLE_SETTINGS = {
  showConsultationPrice: z.boolean({ message: 'El interruptor del precio debe ser verdadero o falso' }),
  consultationPrice: z.preprocess(emptyToNull, intIn(1_000, 10_000_000, 'Valor de la asesoría').nullable()),
  'notify.leadEmails': z
    .array(email)
    .max(10, { message: 'Máximo 10 correos de aviso' })
    .transform((list) => [...new Set(list)]),
  'company.email': z.preprocess(emptyToNull, email.nullable()),
  'company.phone': z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .max(40)
      .regex(/^\+?[\d\s()-]{7,}$/, { message: 'Teléfono no válido (solo dígitos, espacios, guiones o paréntesis)' })
      .nullable(),
  ),
  'bot.greeting': botText(500),
  'bot.declined': botText(600),
  'bot.closing': botText(600),
  'bot.optOutConfirmation': botText(500),
  'marketing.maxPerContactPerDay': intIn(1, 5, 'Máximo por contacto al día'),
  'marketing.maxPerContactPerWeek': intIn(1, 14, 'Máximo por contacto a la semana'),
  'marketing.dailyGlobalLimit': intIn(1, 10_000, 'Límite diario global'),
} satisfies Partial<Record<SettingKey, z.ZodType>>;

export type EditableSettingKey = keyof typeof EDITABLE_SETTINGS;
export const EDITABLE_SETTING_KEYS = Object.keys(EDITABLE_SETTINGS) as EditableSettingKey[];

export type SettingsPatchResult =
  { ok: true; values: Partial<Record<EditableSettingKey, unknown>> } | { ok: false; errors: string[] };

/**
 * Valida un cambio parcial contra los valores vigentes (reglas cruzadas: precio visible exige
 * valor; el tope semanal no puede ser menor que el diario).
 */
export function validateSettingsPatch(
  patch: Record<string, unknown>,
  current: Record<EditableSettingKey, unknown>,
): SettingsPatchResult {
  const errors: string[] = [];
  const values: Partial<Record<EditableSettingKey, unknown>> = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in EDITABLE_SETTINGS)) {
      errors.push(`El parámetro «${key}» no se puede editar desde el panel`);
      continue;
    }
    const parsed = EDITABLE_SETTINGS[key as EditableSettingKey].safeParse(raw);
    if (parsed.success) values[key as EditableSettingKey] = parsed.data;
    else errors.push(...parsed.error.issues.map((i) => i.message));
  }
  if (errors.length) return { ok: false, errors };

  const merged = { ...current, ...values };
  if (merged.showConsultationPrice === true && typeof merged.consultationPrice !== 'number') {
    errors.push('Para mostrar el precio, escribe el valor de la asesoría inicial');
  }
  if (Number(merged['marketing.maxPerContactPerWeek']) < Number(merged['marketing.maxPerContactPerDay'])) {
    errors.push('El máximo semanal por contacto no puede ser menor que el diario');
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}

/** Límites de la Ley 2300 de 2023 por día (0 = domingo): fuera de esto no se puede configurar */
export const LEY_2300_LIMITS: Record<number, { opensAt: string; closesAt: string } | null> = {
  0: null,
  1: { opensAt: '07:00', closesAt: '19:00' },
  2: { opensAt: '07:00', closesAt: '19:00' },
  3: { opensAt: '07:00', closesAt: '19:00' },
  4: { opensAt: '07:00', closesAt: '19:00' },
  5: { opensAt: '07:00', closesAt: '19:00' },
  6: { opensAt: '08:00', closesAt: '15:00' },
};

export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
