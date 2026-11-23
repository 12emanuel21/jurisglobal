import { SETTING_DEFAULTS } from '../settings/defaults';
import { buildOutOfFlowSystemPrompt } from '../ai/prompts';
import {
  CONSENT_NO_ID,
  CONSENT_YES_ID,
  extractColombianPhone,
  extractEmail,
  fallbackAnswer,
  formatCop,
  isRequestInsteadOfName,
  isRestartCommand,
  isStopCommand,
  looksLikeQuestion,
  matchMotivo,
  normalizeText,
  parseConsentAnswer,
  parseFlowState,
  parseFullName,
  parseNameAndNeed,
  isDirectQuestion,
  isSessionExpired,
  SESSION_TTL_MS,
  sanitizeAiReply,
  splitLeadingConsent,
  visibleConsultationPrice,
} from './flow';

const STOP = SETTING_DEFAULTS['marketing.stopKeywords'];
const MOTIVOS = [
  { id: 'm1', name: 'Tránsito' },
  { id: 'm2', name: 'Cartera' },
  { id: 'm3', name: 'Deudas' },
  { id: 'm4', name: 'Otro' },
];

describe('chatbot/flow', () => {
  it('normalizeText: sin tildes, mayúsculas ni signos', () => {
    expect(normalizeText('¡NO quiero MÁS mensajes!')).toBe('no quiero mas mensajes');
    expect(normalizeText('  Tránsito. ')).toBe('transito');
  });

  it('parseFlowState: estado desconocido -> IDLE', () => {
    expect(parseFlowState('ASK_EMAIL')).toBe('ASK_EMAIL');
    expect(parseFlowState('GREETING')).toBe('IDLE');
    expect(parseFlowState(null)).toBe('IDLE');
  });

  describe('baja (STOP)', () => {
    it.each([
      'STOP',
      'stop.',
      'Baja',
      'BAJA por favor',
      'No quiero más mensajes',
      'NO QUIERO MAS MENSAJES!',
      'darme de baja',
    ])('"%s" es una baja', (text) => expect(isStopCommand(text, STOP)).toBe(true));
    it.each(['No quiero que me embarguen', 'quiero bajar mi deuda', 'stop al embargo', 'no', 'Pare de llamarme'])(
      '"%s" NO es una baja (solo mensajes completos e inequívocos)',
      (text) => expect(isStopCommand(text, STOP)).toBe(false),
    );
  });

  it('reinicio: "reiniciar" / "inicio" como mensaje completo', () => {
    expect(isRestartCommand('Reiniciar')).toBe(true);
    expect(isRestartCommand('INICIO')).toBe(true);
    expect(isRestartCommand('inicio por favor')).toBe(true);
    expect(isRestartCommand('el inicio del proceso')).toBe(false);
  });

  it('autorización: botones por id y texto inequívoco', () => {
    expect(parseConsentAnswer('Acepto', CONSENT_YES_ID)).toBe('yes');
    expect(parseConsentAnswer('No acepto', CONSENT_NO_ID)).toBe('no');
    expect(parseConsentAnswer('sí, acepto', null)).toBe('yes');
    expect(parseConsentAnswer('No', null)).toBe('no');
    expect(parseConsentAnswer('tal vez', null)).toBeNull();
    expect(parseConsentAnswer('Tránsito', 'motivo:m1')).toBeNull();
  });

  describe('preguntas fuera de flujo', () => {
    it.each(['¿Cuánto cuesta la consulta?', 'Dónde están ubicados', 'Me pueden ayudar con un embargo', 'cuanto vale'])(
      '"%s" es una pregunta',
      (text) => expect(looksLikeQuestion(text)).toBe(true),
    );
    it.each(['Ana María Pérez', 'ana@correo.co', '2', 'Tránsito'])('"%s" no es una pregunta', (text) =>
      expect(looksLikeQuestion(text)).toBe(false),
    );
    it('una petición sin signos no se toma como nombre', () => {
      expect(isRequestInsteadOfName('Necesito ayuda con una multa')).toBe(true);
      expect(isRequestInsteadOfName('Ana María Pérez')).toBe(false);
    });
  });

  describe('nombre completo', () => {
    it('acepta nombres con tildes, prefijos y capitaliza si viene todo en minúsculas', () => {
      expect(parseFullName('Ana María Pérez')).toBe('Ana María Pérez');
      expect(parseFullName('me llamo carlos de la hoz')).toBe('Carlos de la Hoz');
      expect(parseFullName('JOSÉ GÓMEZ.')).toBe('José Gómez');
      expect(parseFullName("Mi nombre es María O'Neil")).toBe("María O'Neil");
    });
    it.each([
      '',
      '   ',
      '12345',
      '***',
      'Ana123',
      'hola',
      'Buenas tardes',
      'A',
      'uno dos tres cuatro cinco seis siete',
    ])('rechaza "%s"', (text) => expect(parseFullName(text)).toBeNull());
  });

  it('correo: lo extrae del texto, en minúsculas; rechaza los inválidos', () => {
    expect(extractEmail('Ana@Correo.CO')).toBe('ana@correo.co');
    expect(extractEmail('mi correo es ana.perez@gmail.com.')).toBe('ana.perez@gmail.com');
    expect(extractEmail('ana@@correo')).toBeNull();
    expect(extractEmail('ana@correo')).toBeNull();
    expect(extractEmail('no tengo')).toBeNull();
  });

  it('teléfono de Colombia escrito (solo si el WhatsApp es extranjero)', () => {
    expect(extractColombianPhone('300 123 4567')).toBe('573001234567');
    expect(extractColombianPhone('+57 (605) 123-4567')).toBe('576051234567');
    expect(extractColombianPhone('12345')).toBeNull();
  });

  it('motivo: id del interactivo, número, nombre sin tildes o mención única', () => {
    expect(matchMotivo('Cartera', 'motivo:m2', MOTIVOS)?.id).toBe('m2');
    expect(matchMotivo('x', 'motivo:inactivo', MOTIVOS)).toBeNull();
    expect(matchMotivo('3', null, MOTIVOS)?.name).toBe('Deudas');
    expect(matchMotivo('opción 1', null, MOTIVOS)?.name).toBe('Tránsito');
    expect(matchMotivo('TRANSITO', null, MOTIVOS)?.name).toBe('Tránsito');
    expect(matchMotivo('es por un tema de cartera', null, MOTIVOS)?.name).toBe('Cartera');
    expect(matchMotivo('cartera y deudas', null, MOTIVOS)).toBeNull();
    expect(matchMotivo('9', null, MOTIVOS)).toBeNull();
    expect(matchMotivo('Acepto', CONSENT_YES_ID, MOTIVOS)).toBeNull();
  });

  it('precio: "$100.000 COP" solo con el interruptor encendido y un valor', () => {
    expect(formatCop(100000)).toBe('$100.000 COP');
    expect(formatCop(1250000)).toBe('$1.250.000 COP');
    expect(visibleConsultationPrice(true, 100000)).toBe('$100.000 COP');
    expect(visibleConsultationPrice(false, 100000)).toBeNull();
    expect(visibleConsultationPrice(true, null)).toBeNull();
  });

  describe('respuesta de la IA', () => {
    it('máximo 2 frases y sin cortar palabras', () => {
      expect(sanitizeAiReply('Hola. Estamos en Barranquilla. Atendemos virtual. Escríbenos.')).toBe(
        'Hola. Estamos en Barranquilla.',
      );
      expect(sanitizeAiReply('x '.repeat(300))?.length).toBeLessThanOrEqual(320);
    });
    it('no parte frases en el punto de miles del precio', () => {
      expect(
        sanitizeAiReply('La asesoría inicial tiene un valor de $100.000 COP. Un asesor te contactará. Gracias.'),
      ).toBe('La asesoría inicial tiene un valor de $100.000 COP. Un asesor te contactará.');
    });
    it.each([
      'La consulta es gratis.',
      'La asesoría inicial es gratuita.',
      'Te garantizamos el resultado.',
      'Eliminamos tu reporte en Datacrédito.',
      '',
    ])('descarta lo prohibido: "%s"', (reply) => expect(sanitizeAiReply(reply)).toBeNull());
  });

  describe('respuesta fija (si la IA falla)', () => {
    it('precio con el interruptor encendido: informa el valor', () => {
      expect(fallbackAnswer('¿Cuánto cuesta la consulta?', '$100.000 COP')).toContain('$100.000 COP');
    });
    it('precio con el interruptor apagado: un asesor confirma las condiciones, nunca "gratis"', () => {
      const answer = fallbackAnswer('¿cuánto vale?', null);
      expect(answer).toContain('confirmará las condiciones');
      expect(normalizeText(answer)).not.toMatch(/gratis|gratuit|sin costo|\$/);
    });
    it('ubicación y otros temas', () => {
      expect(fallbackAnswer('¿Dónde están ubicados?', null)).toContain('Barranquilla');
      expect(fallbackAnswer('¿Me ayudan con un embargo?', null)).toContain('no damos asesoría jurídica');
    });
  });

  describe('prompt de Gemini', () => {
    it('interruptor encendido: inyecta el valor exacto', () => {
      const prompt = buildOutOfFlowSystemPrompt({ consultationPrice: '$100.000 COP', pendingStep: 'su correo' });
      expect(prompt).toContain('La asesoría inicial tiene un valor de $100.000 COP');
      expect(prompt).toContain('Barranquilla');
      expect(prompt).toContain('su correo');
    });
    it('interruptor apagado: sin precio y prohibido decir gratis', () => {
      const prompt = buildOutOfFlowSystemPrompt({ consultationPrice: null, pendingStep: 'su nombre' });
      expect(prompt).not.toMatch(/\$\d/);
      expect(prompt).toContain('un asesor le confirmará las condiciones');
      expect(prompt).toContain('Nunca digas que es gratis');
      expect(prompt).toMatch(/NUNCA des asesoría jurídica/);
      expect(prompt).toMatch(/1 o 2 frases cortas/);
    });
  });

  describe('sesión de 15 minutos', () => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 23, 15, min));
    it('vence tras más de 15 min sin mensajes', () => {
      expect(SESSION_TTL_MS).toBe(15 * 60 * 1000);
      expect(isSessionExpired(at(0), at(15))).toBe(false); // justo 15 min: sigue
      expect(isSessionExpired(at(0), new Date(at(15).getTime() + 1))).toBe(true);
      expect(isSessionExpired(null, at(30))).toBe(false); // primera vez: no hay sesión anterior
    });
  });

  describe('nombre y consulta en un mismo mensaje', () => {
    it.each([
      ['Ana María Pérez', 'Ana María Pérez', null],
      ['ana maria perez', 'Ana Maria Perez', null],
      ['Soy Ana María Pérez y necesito ayuda con un embargo', 'Ana María Pérez', 'necesito ayuda con un embargo'],
      [
        'Hola, buenas tardes. Mi nombre es Carlos Gómez, me embargaron la cuenta',
        'Carlos Gómez',
        'me embargaron la cuenta',
      ],
      ['Carlos Gómez\nTengo un reporte en Datacrédito', 'Carlos Gómez', 'Tengo un reporte en Datacrédito'],
      [
        'Me llamo María de los Ángeles Ruiz. Tengo deudas con el banco',
        'María de los Ángeles Ruiz',
        'Tengo deudas con el banco',
      ],
      ['Pedro Ramírez tengo una fotomulta', 'Pedro Ramírez', 'tengo una fotomulta'],
      [
        'Buenos días, les escribe Laura Méndez - quisiera información de insolvencia',
        'Laura Méndez',
        'quisiera información de insolvencia',
      ],
    ])('«%s»', (text, name, need) => {
      expect(parseNameAndNeed(text)).toEqual({ name, need });
    });

    it('sin nombre: solo la consulta (o nada si es un saludo)', () => {
      expect(parseNameAndNeed('Necesito ayuda con Datacrédito')).toEqual({
        name: null,
        need: 'Necesito ayuda con Datacrédito',
      });
      expect(parseNameAndNeed('Me ayudan con un embargo')).toEqual({ name: null, need: 'Me ayudan con un embargo' });
      expect(parseNameAndNeed('Banco de Bogotá me embargó')).toEqual({
        name: null,
        need: 'Banco de Bogotá me embargó',
      });
      expect(parseNameAndNeed('Hola, buenas tardes')).toEqual({ name: null, need: null });
      expect(parseNameAndNeed('Hola')).toEqual({ name: null, need: null });
      expect(parseNameAndNeed('Hola de nuevo')).toEqual({ name: null, need: null }); // no es una consulta
    });

    it('en el primer mensaje solo cuenta una presentación explícita', () => {
      expect(parseNameAndNeed('Hola buenas tardes', { requireIntro: true }).name).toBeNull();
      expect(parseNameAndNeed('Juan', { requireIntro: true }).name).toBeNull();
      expect(parseNameAndNeed('Hola, soy Juan Díaz y tengo un embargo', { requireIntro: true })).toEqual({
        name: 'Juan Díaz',
        need: 'tengo un embargo',
      });
    });

    it('pregunta directa (va a la IA) vs. consulta (se guarda)', () => {
      expect(isDirectQuestion('¿Cuánto cuesta la asesoría?')).toBe(true);
      expect(isDirectQuestion('Dónde están ubicados')).toBe(true);
      expect(isDirectQuestion('Necesito ayuda con un embargo')).toBe(false);
      expect(isDirectQuestion('Tengo un reporte en Datacrédito')).toBe(false);
    });

    it('«Sí, soy Ana Pérez»: autorización escrita seguida del nombre', () => {
      expect(splitLeadingConsent('Sí, soy Ana Pérez')).toEqual({ answer: 'yes', rest: 'soy Ana Pérez' });
      expect(splitLeadingConsent('Acepto. Me llamo Luis Gómez')).toEqual({
        answer: 'yes',
        rest: 'Me llamo Luis Gómez',
      });
      expect(splitLeadingConsent('Ana Pérez, tengo un embargo')).toBeNull();
      expect(splitLeadingConsent('Acepto')).toBeNull(); // sin resto: lo resuelve parseConsentAnswer
    });
  });
});
