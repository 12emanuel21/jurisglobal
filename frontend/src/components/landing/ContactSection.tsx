import { Clock, Mail, MessageCircle, Phone } from 'lucide-react';
import { displayPhone, site, whatsappUrl } from '@/lib/site';
import { ContactForm } from './ContactForm';

export function ContactSection() {
  const wa = whatsappUrl();
  return (
    <section id="contacto" className="scroll-mt-20 bg-white py-16 sm:py-20" aria-labelledby="contacto-title">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.35fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold-700">Contacto</p>
          <h2 id="contacto-title" className="mt-2 font-serif text-3xl font-bold text-navy sm:text-4xl">
            Déjanos tus datos y un analista juridico se contactará contigo
          </h2>
          <p className="mt-4 leading-relaxed text-slate-700">
            Cuéntanos brevemente el motivo de tu consulta. Un analista juridico de JurisGlobal revisará tu solicitud y se comunicará contigo por llamada
            o correo para explicarte el siguiente paso.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-slate-700">
            {wa && (
              <li className="flex items-center gap-3">
                <MessageCircle className="h-5 w-5 text-navy" aria-hidden="true" />
                <a href={wa} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline-offset-4 hover:underline">
                  WhatsApp {displayPhone(site.whatsappNumber)}
                </a>
              </li>
            )}
            
            {site.contactEmail && (
              <li className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-navy" aria-hidden="true" />
                <a href={`mailto:${site.contactEmail}`} className="break-all font-semibold text-navy underline-offset-4 hover:underline">
                  {site.contactEmail}
                </a>
              </li>
            )}
            <li className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-navy" aria-hidden="true" />
              <span>Recibimos solicitudes a toda hora; te contactamos en horario laboral.</span>
            </li>
          </ul>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/60 sm:p-8">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
