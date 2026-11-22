import { Compass, HeartHandshake, MessagesSquare } from 'lucide-react';

const PILLARS = [
  {
    icon: HeartHandshake,
    title: 'Trato humano',
    text: 'Te escuchamos sin juicios ni presión. La cobranza la entendemos como un acuerdo y una solución, no como una amenaza.',
  },
  {
    icon: Compass,
    title: 'Prevención',
    text: 'Te orientamos a tiempo para que entiendas tus opciones antes de que una situación legal o financiera se complique.',
  },
  {
    icon: MessagesSquare,
    title: 'Claridad',
    text: 'Te explicamos cada paso en lenguaje sencillo, con información honesta sobre lo que es viable en tu caso.',
  },
];

const VALUES = ['Tranquilidad', 'Confianza', 'Compromiso', 'Prevención', 'Excelencia', 'Humanidad', 'Innovación'];

const PARTNERS = [
  { initials: 'RJ', name: 'Ronaldo Jiménez Acuña', role: 'Gerente General y Representante Legal' },
  { initials: 'JA', name: 'Jeremy Arenillas', role: 'Gerente Administrativo y Financiero' },
];

export function WhyUs() {
  return (
    <section id="nosotros" className="scroll-mt-20 bg-slate-50 py-16 sm:py-20" aria-labelledby="nosotros-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold-700">Por qué JurisGlobal</p>
            <h2 id="nosotros-title" className="mt-2 font-serif text-3xl font-bold text-navy sm:text-4xl">
              Somos tu aliado, no tu adversario
            </h2>
            <p className="mt-4 leading-relaxed text-slate-700">
              JurisGlobal es una firma jurídica y financiera de Barranquilla con cobertura nacional. Acompañamos a personas, comerciantes y
              empresas en crecimiento que buscan recuperar el control de su situación con un servicio cercano, confiable y accesible.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Nuestros valores">
              {VALUES.map((v) => (
                <li key={v} className="rounded-full border border-gold/50 bg-white px-3 py-1 text-xs font-semibold text-navy">
                  {v}
                </li>
              ))}
            </ul>
          </div>

          <ul className="grid gap-4">
            {PILLARS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy/5 text-navy">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-bold text-navy">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-14">
          <h3 className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-gold-700">Socios fundadores</h3>
          <ul className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
            {PARTNERS.map((p) => (
              <li key={p.name} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy font-serif text-lg font-bold text-gold-400 ring-2 ring-gold/40" aria-hidden="true">
                  {p.initials}
                </span>
                <div>
                  <p className="font-bold text-navy">{p.name}</p>
                  <p className="text-sm text-slate-600">{p.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
