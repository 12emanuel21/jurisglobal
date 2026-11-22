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
  /** Interruptor del precio de la asesoría inicial: apagado = la web y el bot no muestran valor (nunca "gratis") */
  showConsultationPrice: false as boolean,
  /** Valor en COP (entero). Por confirmar (ESP §10.2: referencia $80.000–$150.000) */
  consultationPrice: null as number | null,

  /** Topes de masivos aprobados en la Etapa 0 (editables) */
  'marketing.maxPerContactPerDay': 1,
  'marketing.maxPerContactPerWeek': 2,
  'marketing.dailyGlobalLimit': 250,
  /** Retraso aleatorio entre envíos (ms): editable en Configuración (3–12 s por defecto) */
  'marketing.jitterMs': { min: 3000, max: 12000 },
  /** Última calidad del número reportada por Meta (la escribe el worker o el webhook; el panel la muestra) */
  'whatsapp.quality': null as null | { rating: string; source: 'GRAPH' | 'WEBHOOK'; at: string; event?: string },
  /** Pausa automática de campañas si Meta marca la calidad del número en rojo */
  'marketing.pauseOnQualityRed': true,
  /**
   * Expresiones que dan de baja: se comparan con el mensaje COMPLETO, sin tildes, mayúsculas ni signos
   * ("No quiero que me embarguen" no es una baja). Solo frases inequívocas.
   */
  'marketing.stopKeywords': [
    'stop',
    'baja',
    'darme de baja',
    'dar de baja',
    'no quiero mas mensajes',
    'no quiero recibir mas mensajes',
    'no mas mensajes',
    'no me escriban mas',
    'no me envien mas mensajes',
    'cancelar suscripcion',
    'unsubscribe',
  ],

  /** Destinatarios del correo de lead nuevo (por ahora, el correo del desarrollador: se completa en Configuración) */
  'notify.leadEmails': [] as string[],

  /** Enlaces de los textos legales (provisionales durante el desarrollo, ESP §11). Rutas relativas o URLs */
  'legal.links': { privacy: '/legal/privacidad', terms: '/legal/terminos', cookies: '/legal/cookies' },

  'company.name': 'JURISGLOBAL, Soluciones Jurídicas y Financieras',
  'company.nit': null as string | null,
  'company.slogan': 'Tu tranquilidad, nuestra misión.',
  /** Canales institucionales que el bot comparte (vacíos: PUBLIC_BASE_URL y NEXT_PUBLIC_CONTACT_EMAIL) */
  'company.website': null as string | null,
  'company.email': null as string | null,
  'company.phone': null as string | null,

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

  /** Textos del bot (Etapa 4; editables en Configuración, Etapa 5). Formato de WhatsApp: *negrita* */
  'bot.greeting':
    '¡Hola! 👋 Te damos la bienvenida a *JurisGlobal*, Soluciones Jurídicas y Financieras. Te ayudaré a dejar tus datos para que un asesor se comunique contigo por llamada o correo.',
  'bot.declined':
    'Entendido, respetamos tu decisión. Sin tu autorización no podemos registrar tus datos por este medio. Si lo prefieres, puedes contactarnos por nuestros canales institucionales:',
  'bot.closing':
    'Gracias, hemos registrado tus datos. Un asesor de JurisGlobal se comunicará contigo pronto por llamada o correo.',
  'bot.optOutConfirmation':
    'Listo, registramos tu solicitud: no volverás a recibir mensajes automáticos de JurisGlobal por este medio. Si más adelante quieres dejar tus datos, escribe *INICIO*.',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
