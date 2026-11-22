import { Briefcase, ChevronDown, Gavel, HandCoins, Scale, ShieldCheck, TrendingUp, type LucideIcon } from 'lucide-react';
import { OpenDetailLink } from './OpenDetailLink';
import { SelectMotivoLink } from './SelectMotivoLink';

export interface ServiceDetail {
  term: string;
  text: string;
}

export interface Service {
  /** Ancla del desglose (#detalle-<id>) */
  id: string;
  /**
   * Nombre EXACTO del motivo en Configuración › Motivos (máx. 20 caracteres por los botones de
   * WhatsApp): el botón «Consultar sobre…» preselecciona ese motivo en el formulario.
   */
  motivo: string;
  title: string;
  /** Texto del botón: «Consultar sobre …» */
  cta: string;
  icon: LucideIcon;
  summary: string;
  items: string[];
  highlight?: boolean;
  /** Desglose del área (acordeón bajo la cuadrícula). Las áreas sin desglose no aparecen allí. */
  details?: ServiceDetail[];
  /** Título del desglose (por defecto, el de la tarjeta) */
  detailTitle?: string;
}

/**
 * Las 6 áreas de servicio (2 filas × 3 en escritorio). Redacción prudente (ESP §11): sin promesas de
 * resultado. Para agregar el desglose de otra área basta con llenar su `details`.
 */
export const SERVICES: Service[] = [
  {
    id: 'centrales-de-riesgo',
    motivo: 'Centrales de riesgo',
    title: 'Datacrédito y centrales de riesgo',
    cta: 'Datacrédito y centrales de riesgo',
    icon: ShieldCheck,
    highlight: true,
    detailTitle: 'Centrales de riesgo y recuperación crediticia',
    summary: 'Revisamos tu historial crediticio y ejercemos tu derecho de habeas data frente a reportes negativos o irregulares.',
    items: [
      'Diagnóstico en Datacrédito y TransUnion',
      'Reclamaciones por habeas data y corrección de reportes',
      'Estudio de permanencia y recuperación crediticia',
    ],
    details: [
      { term: 'Reportes negativos en Datacrédito y TransUnion', text: 'diagnóstico y revisión de la información crediticia.' },
      {
        term: 'Habeas data financiero',
        text: 'reclamaciones por vulneración del derecho a conocer, actualizar y rectificar información financiera.',
      },
      { term: 'Corrección de reportes negativos', text: 'reclamaciones por información inexacta, incompleta o desactualizada.' },
      { term: 'Permanencia de información negativa', text: 'estudio de términos legales y condiciones de permanencia.' },
      {
        term: 'Reportes sin autorización o con irregularidades',
        text: 'revisión de los requisitos legales y de la documentación que respalda el reporte.',
      },
      {
        term: 'Actualización y eliminación de reportes',
        text: 'solicitudes ante las fuentes y operadores de información cuando exista fundamento legal.',
      },
      { term: 'Recuperación del perfil crediticio', text: 'orientación para mejorar el historial y fortalecer la vida financiera.' },
    ],
  },
  {
    id: 'insolvencia',
    motivo: 'Insolvencia y deudas',
    title: 'Insolvencia y negociación de deudas',
    cta: 'insolvencia y negociación de deudas',
    icon: HandCoins,
    summary: 'Te acompañamos para reorganizar tus obligaciones y lograr acuerdos realistas con tus acreedores.',
    items: ['Insolvencia de persona natural no comerciante', 'Acuerdos de pago viables', 'Negociación directa con bancos y acreedores'],
  },
  {
    id: 'reestructuracion',
    motivo: 'Reestructuración',
    title: 'Reestructuración financiera',
    cta: 'reestructuración financiera',
    icon: TrendingUp,
    summary: 'Ordenamos tus pasivos y trazamos una ruta clara para tu estabilidad y recuperación económica.',
    items: ['Organización y diagnóstico de pasivos', 'Estrategia de recuperación económica', 'Planeación financiera preventiva'],
  },
  {
    id: 'procesos-embargos',
    motivo: 'Procesos y embargos',
    title: 'Procesos judiciales y embargos',
    cta: 'procesos judiciales y embargos',
    icon: Gavel,
    summary: 'Defendemos tu patrimonio y tus derechos frente a cobros judiciales y medidas cautelares.',
    items: ['Defensa jurídica en procesos ejecutivos', 'Levantamiento y revisión de medidas cautelares', 'Acompañamiento ante embargos'],
  },
  {
    id: 'laboral-empresarial',
    motivo: 'Derecho laboral',
    title: 'Derecho laboral y empresarial',
    cta: 'derecho laboral y empresarial',
    icon: Briefcase,
    summary: 'Asesoría integral para trabajadores y empresas en relaciones laborales y prevención de conflictos.',
    items: ['Despidos, liquidaciones y prestaciones sociales', 'Elaboración y revisión de contratos', 'Asesoría jurídica a trabajadores y empresas'],
  },
  {
    id: 'civil-familia-transito',
    motivo: 'Familia y tránsito',
    title: 'Derecho civil, familia y tránsito',
    cta: 'derecho civil, familia y tránsito',
    icon: Scale,
    summary: 'Acompañamiento legal cercano en asuntos familiares, patrimoniales y trámites de movilidad.',
    items: ['Divorcios, sucesiones, alimentos y paternidad', 'Impugnación y prescripción de multas de tránsito', 'Defensa en cobros coactivos'],
  },
];

export const SERVICE_DETAILS_ID = 'detalle-servicios';

export function Services() {
  const withDetails = SERVICES.filter((s) => s.details?.length);
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

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Áreas de servicio">
          {SERVICES.map(({ id, motivo, title, cta, icon: Icon, summary, items, highlight, details }) => (
            <li
              key={id}
              data-testid={`service-${id}`}
              className={`flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${
                highlight ? 'border-[#ca9e3d] ring-1 ring-[#ca9e3d]/40' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0d223d] text-[#ca9e3d]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {highlight && (
                  <span className="rounded-full bg-[#0d223d] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#ca9e3d]">
                    Foco principal
                  </span>
                )}
              </div>
              <h3 className="mt-4 text-lg font-bold leading-snug text-[#0d223d]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-700">
                {items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ca9e3d]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-col items-start gap-1">
                <SelectMotivoLink motivo={motivo}>Consultar sobre {cta}</SelectMotivoLink>
                {details?.length ? (
                  <OpenDetailLink detailsId={SERVICE_DETAILS_ID} targetId={`detalle-${id}`}>
                    Ver detalle del servicio
                  </OpenDetailLink>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {withDetails.length > 0 && (
          <details id={SERVICE_DETAILS_ID} className="group mt-8 scroll-mt-24 rounded-2xl border border-slate-200 bg-[#f8fafc]">
            <summary className="tap flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 font-semibold text-[#0d223d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ca9e3d] [&::-webkit-details-marker]:hidden">
              Ver detalle de servicios por área
              <ChevronDown className="h-5 w-5 shrink-0 text-[#ca9e3d] transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-8 border-t border-slate-200 px-5 pb-6 pt-5">
              {withDetails.map((s) => (
                <section key={s.id} id={`detalle-${s.id}`} aria-labelledby={`detalle-${s.id}-title`} className="scroll-mt-24">
                  <h3 id={`detalle-${s.id}-title`} className="font-serif text-xl font-bold text-[#0d223d]">
                    {s.detailTitle ?? s.title}
                  </h3>
                  <ul className="mt-4 grid gap-3 md:grid-cols-2">
                    {s.details!.map((d) => (
                      <li key={d.term} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ca9e3d]" aria-hidden="true" />
                        <span>
                          <em className="font-semibold text-[#0d223d]">{d.term}:</em> {d.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <SelectMotivoLink motivo={s.motivo} className="mt-4">
                    Consultar sobre {s.cta}
                  </SelectMotivoLink>
                </section>
              ))}
            </div>
          </details>
        )}

        <p className="mt-8 text-xs leading-relaxed text-slate-500">
          La información de este sitio es general y no constituye asesoría jurídica. Cada caso se analiza de forma individual y su resultado
          depende de las circunstancias particulares y de la normatividad vigente.
        </p>
      </div>
    </section>
  );
}
