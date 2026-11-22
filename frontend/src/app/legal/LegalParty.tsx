import { site } from '@/lib/site';

/** Identificación del responsable (datos pendientes, ESP §13.1) */
export function LegalParty() {
  return (
    <p>
      <strong>Responsable:</strong> JURISGLOBAL, Soluciones Jurídicas y Financieras ({site.nitInfo || 'NIT pendiente'}), con domicilio en
      Barranquilla, Colombia. Correo de contacto: {site.contactEmail || '[correo pendiente]'}.
    </p>
  );
}

export const LAST_UPDATED = '22 de noviembre de 2026 (borrador)';
