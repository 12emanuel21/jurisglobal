/**
 * Parámetros editables (tabla Setting). El seed solo crea las claves que faltan: nunca pisa lo que
 * el equipo ya cambió desde Configuración. Textos legales y del bot: versión inicial, a revisar por
 * los abogados antes de publicar (ESP §11, §13).
 */
export interface ConsentText {
  version: number;
  text: string;
}

export const SETTING_DEFAULTS = {
  /** Interruptor del precio de la asesoría inicial: apagado = la web y el bot la presentan sin costo */
  showConsultationPrice: false as boolean,
  /** Valor en COP (entero). Por confirmar (ESP §10.2: referencia $80.000–$150.000) */
  consultationPrice: null as number | null,

  /** Topes de masivos aprobados en la Etapa 0 (editables) */
  'marketing.maxPerContactPerDay': 1,
  'marketing.maxPerContactPerWeek': 2,
  'marketing.dailyGlobalLimit': 250,
  /** Retraso aleatorio entre envíos (ms) */
  'marketing.jitterMs': { min: 4000, max: 15000 },
  /** Pausa automática de campañas si Meta marca la calidad del número en rojo */
  'marketing.pauseOnQualityRed': true,
  /** Palabras que dan de baja (se comparan sin tildes ni mayúsculas) */
  'marketing.stopKeywords': ['stop', 'baja', 'parar', 'no mas', 'no quiero', 'cancelar', 'darme de baja'],

  /** Destinatarios del correo de lead nuevo (por ahora, el correo del desarrollador: se completa en Configuración) */
  'notify.leadEmails': [] as string[],

  /** Enlaces de los textos legales (provisionales durante el desarrollo, ESP §11). Rutas relativas o URLs */
  'legal.links': { privacy: '/legal/privacidad', terms: '/legal/terminos', cookies: '/legal/cookies' },

  'company.name': 'JURISGLOBAL, Soluciones Jurídicas y Financieras',
  'company.nit': null as string | null,
  'company.slogan': 'Tu tranquilidad, nuestra misión.',

  /** Autorizaciones del formulario web (ESP §5). Cambiar el texto = subir la versión */
  'consent.web.privacy': {
    version: 1,
    text: 'Acepto el Aviso de Privacidad, los Términos y Condiciones y la Política de Cookies de JurisGlobal.',
  },
  'consent.web.contact': {
    version: 1,
    text: 'Acepto ser contactado por medio de una cuenta institucional y verificada de JurisGlobal y autorizo el tratamiento de mis datos personales.',
  },
  /** Autorización que el bot pide con botones Acepto / No acepto antes de pedir datos */
  'consent.whatsapp.contact': {
    version: 1,
    text: 'Para ayudarte, JurisGlobal necesita tu autorización para tratar tus datos personales (nombre, correo y teléfono) con el fin de contactarte por una cuenta institucional y verificada, según nuestro Aviso de Privacidad. ¿Nos autorizas?',
  },

  /** Textos del bot (borrador; se ajustan en la Etapa 4) */
  'bot.greeting':
    '¡Hola! 👋 Te damos la bienvenida a JurisGlobal, Soluciones Jurídicas y Financieras. Te ayudo a dejar tus datos para que un asesor te contacte.',
  'bot.declined':
    'Entendido. Sin tu autorización no podemos registrar tus datos. Si cambias de opinión, escríbenos de nuevo por este canal institucional.',
  'bot.closing':
    '¡Gracias! Un asesor de JurisGlobal se comunicará contigo por llamada o correo. Tu mejor decisión hoy, tu tranquilidad mañana.',
  'bot.optOutConfirmation':
    'Listo, no volverás a recibir mensajes informativos de JurisGlobal. Si necesitas algo, puedes escribirnos cuando quieras.',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
