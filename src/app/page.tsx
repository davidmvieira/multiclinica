const features = [
  {
    icon: '📋',
    title: 'Prontuário completo',
    description:
      'Avaliações fisioterapêuticas fiéis aos modelos oficiais, com versionamento automático.',
  },
  {
    icon: '📅',
    title: 'Agenda inteligente',
    description:
      'Visualize, agende e evite conflitos em segundos. Dia, semana ou mês.',
  },
  {
    icon: '💰',
    title: 'Financeiro claro',
    description:
      'Cobranças, recebimentos parciais e saldos em aberto sem planilha.',
  },
];

export default function HomePage() {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur">
        <nav
          aria-label="Navegação principal"
          className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"
        >
          <a href="/" className="text-xl font-bold text-slate-900">
            Iatris
          </a>
          <div className="flex items-center gap-5">
            <a
              href="/login"
              className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
            >
              Entrar
            </a>
            <a
              href="/login?mode=register"
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              Começar
            </a>
          </div>
        </nav>
      </header>

      <main className="pt-16">
        <section className="mx-auto flex min-h-[80vh] max-w-7xl flex-col items-center justify-center gap-14 px-6 py-20 md:flex-row md:gap-16">
          <div className="flex-1">
            <p className="mb-5 text-sm font-semibold uppercase tracking-widest text-emerald-600">
              Gestão clínica sem complicação
            </p>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-slate-900 md:text-6xl">
              A clínica inteira em um só lugar.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              Prontuário, agenda, avaliações e financeiro para profissionais
              que querem mais tempo com o paciente e menos com papel.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/login?mode=register"
                className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition hover:bg-emerald-700"
              >
                Começar agora
              </a>
              <a
                href="#recursos"
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-6 py-3 font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Ver demonstração
              </a>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="w-full max-w-lg flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm sm:p-8"
          >
            <div className="mb-8 flex items-center justify-between">
              <div className="h-3 w-32 rounded-full bg-slate-300" />
              <div className="h-8 w-8 rounded-full bg-emerald-100" />
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="mb-3 h-2.5 w-28 rounded-full bg-slate-200" />
                <div className="h-2 w-full rounded-full bg-slate-100" />
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="mb-3 h-2.5 w-36 rounded-full bg-slate-200" />
                <div className="h-2 w-4/5 rounded-full bg-slate-100" />
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="mb-3 h-2.5 w-24 rounded-full bg-slate-200" />
                <div className="h-2 w-3/5 rounded-full bg-slate-100" />
              </div>
            </div>
          </div>
        </section>

        <section
          id="recursos"
          className="border-t border-slate-100 bg-white px-6 py-24"
        >
          <div className="mx-auto grid max-w-7xl gap-12 md:grid-cols-3 md:gap-8">
            {features.map((feature) => (
              <article key={feature.title}>
                <span className="text-3xl" aria-hidden="true">
                  {feature.icon}
                </span>
                <h2 className="mt-5 text-xl font-semibold text-slate-900">
                  {feature.title}
                </h2>
                <p className="mt-3 leading-relaxed text-slate-600">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-emerald-50 px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Pronto para simplificar sua clínica?
          </h2>
          <a
            href="/login?mode=register"
            className="mt-8 inline-flex items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white transition hover:bg-emerald-700"
          >
            Criar conta grátis
          </a>
        </section>
      </main>

      <footer className="px-6 py-8 text-center text-sm text-slate-500">
        © 2026 Iatris · Feito para fisioterapeutas
      </footer>
    </>
  );
}
