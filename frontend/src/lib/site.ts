/**
 * Datos de contacto públicos (ESP §2, §13.3). Next los incrusta al compilar (NEXT_PUBLIC_*):
 * cambiarlos exige reconstruir la imagen web. Los valores actuales son PROVISIONALES.
 * Las referencias deben ser literales (process.env.NEXT_PUBLIC_X) para que Next las reemplace.
 */
export const site = {
  whatsappNumber: (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, ''),
  whatsappMessage:
    process.env.NEXT_PUBLIC_WHATSAPP_MESSAGE || 'Hola, JurisGlobal. Quiero dejar mis datos para que un asesor me contacte.',
  contactPhone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? '',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '',
  nitInfo: process.env.NEXT_PUBLIC_NIT_INFO ?? '',
  city: 'Barranquilla',
  slogan: 'Tu tranquilidad, nuestra misión.',
  closing: 'Tu mejor decisión hoy, tu tranquilidad mañana.',
};

/** Enlace wa.me con mensaje inicial; null si no hay número configurado (los botones se ocultan) */
export function whatsappUrl(message = site.whatsappMessage, number = site.whatsappNumber): string | null {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

/** "573001234567" -> "+57 300 123 4567"; otros formatos, tal cual */
export function displayPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const m = /^(?:57)?(\d{3})(\d{3})(\d{4})$/.exec(digits);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : value;
}
