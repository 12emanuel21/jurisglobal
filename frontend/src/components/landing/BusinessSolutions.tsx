import { Calculator, Landmark, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { OpenDetailLink } from './OpenDetailLink';
import { SelectMotivoLink } from './SelectMotivoLink';

/** Línea empresarial (B2B): bloque bajo la cuadrícula de servicios y desglose en el acordeón */
export const BUSINESS = {
  id: 'soluciones-pymes',
  /** Motivo en Configuración › Motivos (máx. 20 caracteres) */
  motivo: 'Soluciones PYMES',
  eyebrow: 'Línea empresarial y B2B',
  title: 'Soluciones Estratégicas para PYMES, Comerciantes y Empresas',
  summary: 'Acompañamiento integral jurídico, laboral, contable y financiero para proteger, organizar y hacer crecer tu negocio.',
};

const PILLARS: Array<{ icon: LucideIcon; text: string }> = [
  { icon: Users, text: 'Talento humano y nómina' },
  { icon: Calculator, text: 'Contabilidad y gestión tributaria' },
  { icon: Landmark, text: 'Derecho comercial y cartera' },
  { icon: ShieldCheck, text: 'Consultoría y protección patrimonial' },
];

interface BusinessArea {
  title: string;
  /** Subtítulo y descripción (opcionales) */
  lead?: { subtitle: string; text: string };
  items: string[];
}

export const BUSINESS_AREAS: BusinessArea[] = [
  {
    title: 'Área de Talento Humano y Gestión Laboral Empresarial',
    lead: {
      subtitle: 'Gestión del talento y cumplimiento laboral.',
      text: 'Acompañamos a las empresas en la administración de su talento humano, la organización de sus relaciones laborales y el cumplimiento de las disposiciones legales aplicables a la contratación y gestión del personal.',
    },
    items: [
      'Asesoría en contratación laboral y modalidades de vinculación.',
      'Elaboración y revisión de contratos de trabajo.',
      'Administración de nómina y prestaciones sociales.',
      'Liquidación de salarios, vacaciones, cesantías y demás acreencias laborales.',
      'Afiliaciones y novedades en seguridad social.',
      'Elaboración de manuales de funciones y reglamentos internos.',
      'Asesoría en procesos disciplinarios y terminación de contratos.',
      'Gestión de bienestar y clima organizacional.',
      'Acompañamiento en cumplimiento de obligaciones laborales.',
    ],
  },
  {
    title: 'Área Contable, Financiera y Tributaria',
    lead: {
      subtitle: 'Asesoría contable y cumplimiento tributario.',
      text: 'Ofrecemos acompañamiento contable y tributario para garantizar una adecuada administración de los recursos, el cumplimiento de las obligaciones fiscales y la transparencia financiera de los negocios y empresas.',
    },
    items: [
      'Contabilidad general y organización de registros contables.',
      'Elaboración y presentación de estados financieros.',
      'Asesoría y planeación tributaria.',
      'Preparación y presentación de declaraciones tributarias.',
      'Facturación electrónica y control de ingresos y gastos.',
      'Elaboración de informes financieros.',
      'Cierres contables y conciliaciones.',
      'Acompañamiento en obligaciones fiscales y contables.',
    ],
  },
  {
    title: 'Asesoría Jurídica Empresarial y Comercial',
    items: [
      'Constitución y formalización de empresas y establecimientos de comercio.',
      'Elaboración, revisión y negociación de contratos comerciales.',
      'Asesoría en obligaciones mercantiles y relaciones comerciales.',
      'Cobro y recuperación jurídica de cartera.',
      'Representación y acompañamiento en procesos judiciales y extrajudiciales.',
      'Protección de marcas y propiedad intelectual.',
      'Prevención y solución de conflictos empresariales.',
    ],
  },
  {
    title: 'Gestión Financiera y Recuperación de Cartera',
    items: [
      'Diagnóstico de la situación financiera del negocio.',
      'Organización y planificación de obligaciones económicas.',
      'Gestión preventiva y administrativa de cartera.',
      'Cobranza humanizada y recuperación de cuentas por cobrar.',
      'Negociación y estructuración de acuerdos de pago.',
      'Evaluación de alternativas para el manejo del endeudamiento.',
      'Orientación en procesos de insolvencia y reorganización empresarial.',
    ],
  },
  {
    title: 'Consultoría y Fortalecimiento Empresarial',
    items: [
      'Diagnóstico integral jurídico, financiero y administrativo.',
      'Identificación de riesgos y contingencias empresariales.',
      'Diseño de estrategias de prevención y protección patrimonial.',
      'Acompañamiento en crecimiento y expansión comercial.',
      'Asesoría para la toma de decisiones empresariales.',
      'Implementación de estrategias de cumplimiento normativo.',
    ],
  },
];

/** Bloque destacado de ancho completo bajo la cuadrícula de 6 áreas */
export function BusinessHighlight({ detailsId }: { detailsId: string }) {
  return (
    <section
      aria-labelledby="b2b-title"
      className="relative mt-8 overflow-hidden rounded-2xl bg-[#0d223d] p-6 text-white shadow-lg shadow-[#0d223d]/20 sm:p-8"
      data-testid="b2b-highlight"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-[#ca9e3d]" aria-hidden="true" />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#ca9e3d]">{BUSINESS.eyebrow}</p>
          <h3 id="b2b-title" className="mt-3 font-serif text-2xl font-bold leading-snug sm:text-3xl">
            {BUSINESS.title}
          </h3>
          <p className="mt-3 max-w-xl leading-relaxed text-white/80">{BUSINESS.summary}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <SelectMotivoLink
              motivo={BUSINESS.motivo}
              classes="tap inline-flex items-center justify-center gap-2 rounded-xl bg-[#ca9e3d] px-5 py-3 text-center text-sm font-bold text-[#0d223d] transition-colors hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Consultar soluciones para empresas
            </SelectMotivoLink>
            <OpenDetailLink
              detailsId={detailsId}
              targetId={`detalle-${BUSINESS.id}`}
              classes="tap inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 px-5 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ca9e3d]"
            >
              Ver alcance completo ({BUSINESS_AREAS.length} áreas)
            </OpenDetailLink>
          </div>
        </div>
        <ul aria-label="Pilares de la línea empresarial" className="grid gap-3 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm font-semibold">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ca9e3d]/15 text-[#ca9e3d]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Desglose de la línea empresarial dentro del acordeón «Ver detalle de servicios por área» */
export function BusinessDetail() {
  return (
    <section id={`detalle-${BUSINESS.id}`} aria-label="Alcance completo de la línea empresarial" className="scroll-mt-24">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">{BUSINESS.eyebrow}</p>
      <h3 id={`detalle-${BUSINESS.id}-title`} className="mt-1 font-serif text-xl font-bold text-[#0d223d]">
        {BUSINESS.title}
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {BUSINESS_AREAS.map((area, i) => {
          const last = i === BUSINESS_AREAS.length - 1 && BUSINESS_AREAS.length % 2 === 1;
          return (
            <article
              key={area.title}
              aria-label={area.title}
              className={`rounded-xl border border-slate-200 bg-white p-5 ${last ? 'md:col-span-2' : ''}`}
            >
              <h4 className="flex gap-2 font-bold leading-snug text-[#0d223d]">
                <span className="font-serif text-[#ca9e3d]">{i + 1}.</span> {area.title}
              </h4>
              {area.lead && (
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  <em className="font-semibold text-[#0d223d]">{area.lead.subtitle}</em> {area.lead.text}
                </p>
              )}
              <ul className={`mt-3 space-y-1.5 text-sm text-slate-700 ${last ? 'md:columns-2 md:gap-8' : ''}`}>
                {area.items.map((item) => (
                  <li key={item} className="flex break-inside-avoid gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ca9e3d]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <SelectMotivoLink motivo={BUSINESS.motivo} className="mt-4">
        Consultar soluciones para empresas
      </SelectMotivoLink>
    </section>
  );
}
