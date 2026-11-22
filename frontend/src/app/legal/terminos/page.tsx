import type { Metadata } from 'next';
import { LAST_UPDATED, LegalParty } from '../LegalParty';

export const metadata: Metadata = { title: 'Términos y Condiciones | JurisGlobal' };

/** Texto base de Términos y Condiciones. Pendiente de la redacción definitiva. */
export default function TermsPage() {
  return (
    <>
      <h1>Términos y Condiciones</h1>
      <p className="text-sm text-slate-500">Última actualización: {LAST_UPDATED}</p>
      <LegalParty />

      <h2>1. Objeto del sitio</h2>
      <p>
        Este sitio presenta los servicios de JurisGlobal y permite que dejes tus datos para que un asesor te contacte. El uso del sitio implica la
        aceptación de estos términos.
      </p>

      <h2>2. La información no es asesoría jurídica</h2>
      <p>
        El contenido de este sitio y las respuestas automáticas de nuestros canales son de carácter general e informativo. No constituyen asesoría
        jurídica ni financiera, ni crean una relación profesional. Cada caso se analiza de forma individual por un asesor de JurisGlobal.
      </p>

      <h2>3. Sin garantía de resultados</h2>
      <p>
        JurisGlobal no promete ni garantiza resultados específicos. El resultado de cada gestión depende de las circunstancias particulares del caso,
        de la información aportada y de la normatividad vigente.
      </p>

      <h2>4. Asesoría inicial</h2>
      <p>
        Las condiciones de la asesoría inicial (modalidad, duración y valor, si aplica) se informan antes de agendarla y pueden actualizarse en este
        sitio.
      </p>

      <h2>5. Uso adecuado</h2>
      <p>Te comprometes a suministrar información veraz y a no usar los formularios ni los canales para fines ilícitos o envíos no solicitados.</p>

      <h2>6. Propiedad intelectual</h2>
      <p>La marca, los textos y los elementos gráficos de este sitio pertenecen a JurisGlobal o a sus titulares y no pueden usarse sin autorización.</p>

      <h2>7. Ley aplicable</h2>
      <p>Estos términos se rigen por las leyes de la República de Colombia.</p>
    </>
  );
}
