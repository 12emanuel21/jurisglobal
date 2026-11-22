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
  { initials: 'EV', name: 'Emanuel Ricardo Vargas Villarreal', role: 'Gerente Desarrollador y Soporte Técnico' },
];

export function WhyUs() {
  return (
    <section id="nosotros" className="scroll-mt-20 bg-slate-50 py-16 sm:py-20" aria-labelledby="nosotros-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold-700">Por qué JurisGlobal</p>
            <h2 id="nosotros-title" className="mt-2 font-serif text-3xl font-bold text-navy sm:text-4xl">
              ¿Por qué elegir JURISGLOBAL?
            </h2>
            <div className="mt-5 max-w-prose space-y-4 leading-relaxed text-slate-700" data-testid="why-us-text">
              <p className="border-l-4 border-[#ca9e3d] pl-4 font-serif text-xl font-semibold leading-snug text-navy">
                Porque detrás de cada problema hay una persona que merece ser escuchada y una solución que vale la pena construir.
              </p>
              <p>
                En JURISGLOBAL somos una firma jurídica y financiera con sede en Barranquilla y cobertura nacional. Acompañamos a personas,
                comerciantes, emprendedores y empresas en crecimiento con soluciones integrales, atención personalizada y un compromiso genuino con su
                bienestar.
              </p>
              <p>
                Entendemos que enfrentar una deuda, un conflicto legal o una dificultad empresarial puede generar incertidumbre y preocupación. Por eso,
                nuestro trabajo va más allá de prestar un servicio: te escuchamos, comprendemos tu situación y ponemos nuestro conocimiento y
                experiencia a tu disposición para encontrar alternativas que protejan tus intereses y te permitan avanzar.
              </p>
              <p>
                Nos caracterizamos por brindar una atención cercana, transparente, confiable y accesible, porque creemos que todos merecen orientación
                profesional y la oportunidad de encontrar una solución.
              </p>
              <div className="rounded-2xl bg-navy px-5 py-4">
                <p className="font-semibold text-white">No tienes que enfrentar tus dificultades sin orientación. Estamos aquí para acompañarte.</p>
                <p className="mt-1 text-sm font-medium tracking-wide text-[#ca9e3d]">JURISGLOBAL — Tu tranquilidad, nuestra misión.</p>
              </div>
            </div>
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
          <ul aria-label="Socios fundadores" className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
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
