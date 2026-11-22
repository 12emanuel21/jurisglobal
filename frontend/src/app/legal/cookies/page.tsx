import type { Metadata } from 'next';
import { LAST_UPDATED, LegalParty } from '../LegalParty';

export const metadata: Metadata = { title: 'Política de Cookies | JurisGlobal' };

/** Texto base de la Política de Cookies, fiel al uso real del sitio hoy (sin analítica ni terceros) */
export default function CookiesPage() {
  return (
    <>
      <h1>Política de Cookies</h1>
      <p className="text-sm text-slate-500">Última actualización: {LAST_UPDATED}</p>
      <LegalParty />

      <h2>1. Qué son las cookies</h2>
      <p>Las cookies son pequeños archivos que un sitio guarda en tu navegador para funcionar correctamente o recordar preferencias.</p>

      <h2>2. Cookies que usamos</h2>
      <ul>
        <li>
          <strong>Estrictamente necesarias:</strong> la cookie de sesión del panel de administración (solo para el equipo de JurisGlobal que inicia
          sesión). Es de origen propio, no accesible por scripts y expira al cerrar la sesión o en pocas horas.
        </li>
        <li>
          <strong>Preferencias:</strong> el navegador puede guardar localmente la preferencia de tema (claro u oscuro) del panel.
        </li>
      </ul>
      <p>Hoy este sitio no usa cookies de analítica, publicidad ni de terceros. Si eso cambia, actualizaremos esta política y te pediremos autorización.</p>

      <h2>3. Cómo gestionarlas</h2>
      <p>Puedes eliminar o bloquear las cookies desde la configuración de tu navegador. Bloquear las necesarias puede impedir el acceso al panel.</p>
    </>
  );
}
