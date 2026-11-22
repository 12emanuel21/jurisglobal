import { Car, FileText, HandCoins, Landmark, type LucideIcon } from 'lucide-react';
import { SelectMotivoLink } from './SelectMotivoLink';

interface Service {
  /** Nombre del motivo en la configuración (preselecciona el formulario) */
  motivo: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  items: string[];
  highlight?: boolean;
}

/**
 * Áreas de atención alineadas con los motivos del MVP (ESP §10). Redacción prudente (ESP §11):
 * sin promesas de resultado; "analizamos", "te orientamos", "cuando legalmente proceda".
 */
const SERVICES: Service[] = [
  {
    motivo: 'Tránsito',
    title: 'Tránsito',
    icon: Car,
    highlight: true,
    summary: 'Revisamos tu situación frente a comparendos y fotomultas y te orientamos en los trámites de movilidad.',
    items: [
      'Análisis de comparendos y fotomultas',
      'Estudio de la viabilidad de prescripción o impugnación, cuando legalmente proceda',
      'Acompañamiento en trámites ante organismos de tránsito',
    ],
  },
  {
    motivo: 'Cartera',
    title: 'Cartera',
    icon: HandCoins,
    summary: 'Cobranza humanizada para empresas y acuerdos de pago realistas, con trato respetuoso y dentro del marco legal.',
    items: ['Gestión de cartera con enfoque de acuerdo', 'Propuestas de pago viables para ambas partes', 'Comunicación respetuosa y documentada'],
  },
  {
    motivo: 'Deudas',
    title: 'Deudas y soluciones financieras',
    icon: Landmark,
    summary: 'Te asesoramos para ordenar tus finanzas y dialogar con bancos, cooperativas y entidades financieras.',
    items: [
      'Acompañamiento en la negociación de deudas',
      'Revisión de reportes en centrales de información y solicitudes de actualización o rectificación, cuando corresponda',
      'Orientación sobre insolvencia de persona natural no comerciante y defensa en procesos ejecutivos',
    ],
  },
  {
    motivo: 'Otro',
    title: 'Orientación jurídica general',
    icon: FileText,
    summary: 'Te ayudamos a entender tu caso y a elegir el mecanismo adecuado para ejercer tus derechos.',
    items: ['Derechos de petición', 'Acciones de tutela', 'Revisión de contratos'],
  },
];

export function Services() {
  return (
    <section id="servicios" className="scroll-mt-20 bg-white py-16 sm:py-20" aria-labelledby="servicios-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold-700">Servicios</p>
          <h2 id="servicios-title" className="mt-2 font-serif text-3xl font-bold text-navy sm:text-4xl">
            Áreas en las que te acompañamos
          </h2>
          <p className="mt-4 text-slate-700">
            Analizamos la viabilidad legal de tu caso y te explicamos con claridad las opciones disponibles antes de que tomes cualquier decisión.
          </p>
        </div>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2">
          {SERVICES.map(({ motivo, title, icon: Icon, summary, items, highlight }) => (
            <li
              key={motivo}
              className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${
                highlight ? 'border-gold/70 ring-1 ring-gold/30' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-gold-400">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {highlight && (
                  <span className="rounded-full bg-navy px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold-400">
                    Foco principal
                  </span>
                )}
              </div>
              <h3 className="mt-4 text-lg font-bold text-navy">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                {items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <SelectMotivoLink motivo={motivo} className="mt-5">
                Consultar sobre {title.toLowerCase()}
              </SelectMotivoLink>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-xs leading-relaxed text-slate-500">
          La información de este sitio es general y no constituye asesoría jurídica. Cada caso se analiza de forma individual y su resultado
          depende de las circunstancias particulares y de la normatividad vigente.
        </p>
      </div>
    </section>
  );
}
