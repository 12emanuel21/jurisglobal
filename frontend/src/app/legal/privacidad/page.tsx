import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { LAST_UPDATED, LegalParty } from '../LegalParty';

export const metadata: Metadata = { title: 'Aviso de Privacidad | JurisGlobal' };

/** Texto base del Aviso de Privacidad (Ley 1581 de 2012). Pendiente de la redacción definitiva. */
export default function PrivacyPage() {
  return (
    <>
      <h1>Aviso de Privacidad</h1>
      <p className="text-sm text-slate-500">Última actualización: {LAST_UPDATED}</p>
      <LegalParty />

      <h2>1. Datos que recolectamos</h2>
      <p>
        Cuando diligencias el formulario de este sitio o nos escribes por WhatsApp, recolectamos tu nombre completo, número de teléfono, correo
        electrónico, el motivo de tu consulta y el contenido de los mensajes que nos envíes, así como la fecha, el canal y el texto de las
        autorizaciones que aceptas.
      </p>

      <h2>2. Finalidades del tratamiento</h2>
      <ul>
        <li>Atender tu solicitud y contactarte por llamada, correo o la cuenta institucional y verificada de WhatsApp de JurisGlobal.</li>
        <li>Agendar y prestar la asesoría inicial y, si contratas, los servicios jurídicos o financieros correspondientes.</li>
        <li>Enviarte información sobre nuestros servicios solo si lo autorizas de forma expresa, con la opción de darte de baja en cualquier momento.</li>
        <li>Cumplir obligaciones legales y atender requerimientos de autoridades competentes.</li>
      </ul>

      <h2>3. Tus derechos como titular</h2>
      <p>De acuerdo con la Ley 1581 de 2012, puedes:</p>
      <ul>
        <li>Conocer, actualizar y rectificar tus datos personales.</li>
        <li>Solicitar prueba de la autorización otorgada.</li>
        <li>Ser informado sobre el uso que se ha dado a tus datos.</li>
        <li>Revocar la autorización y solicitar la supresión de tus datos cuando no exista un deber legal o contractual de conservarlos.</li>
        <li>Acceder gratuitamente a tus datos y presentar quejas ante la Superintendencia de Industria y Comercio.</li>
      </ul>

      <h2>4. Cómo ejercer tus derechos</h2>
      <p>
        Escríbenos a {site.contactEmail || '[correo pendiente]'} indicando tu nombre, teléfono y la solicitud. Si recibes mensajes informativos por
        WhatsApp, puedes responder <strong>STOP</strong> para dejar de recibirlos.
      </p>

      <h2>5. Política de tratamiento</h2>
      <p>
        La Política de Tratamiento de Datos Personales de JurisGlobal, con los procedimientos completos de consulta y reclamo, estará disponible en
        este sitio. Este aviso se emite en cumplimiento de la Ley 1581 de 2012 y sus normas reglamentarias.
      </p>
    </>
  );
}
