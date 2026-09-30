import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

const benefits = [
  "Controle de plantões e repasses",
  "Acompanhamento de pagamentos parciais",
  "Alertas de recebimentos atrasados",
];

export function PricingSection() {
  return (
    <section id="preco" className="border-b border-border/80 bg-slate-950 py-16 text-white md:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 md:grid-cols-[1fr_auto] md:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Plano completo</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Mais clareza para cada plantão.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Tenha seus valores previstos, recebimentos e atrasos organizados em um só lugar.
            </p>
            <ul className="mt-6 grid gap-3 text-sm text-slate-200 sm:grid-cols-3 md:grid-cols-1">
              {benefits.map((benefit) => (
                <li key={benefit} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-emerald-400/40 bg-white p-6 text-slate-900 shadow-xl sm:p-8 md:min-w-80">
            <p className="text-sm font-semibold text-slate-600">Plano mensal (compra avulsa pré-paga)</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-extrabold tracking-tight">R$ 12,90</span>
              <span className="text-sm text-slate-500">/mês</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">Cadastro inicial gratuito, sem cartão.</p>
            <p className="mt-1 text-xs text-slate-500">
              Compra avulsa pré-paga por período fixo. Sem renovação automática. Sem cobranças recorrentes.
            </p>
            <Link
              href="/cadastro"
              className="mt-6 flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 text-base font-bold text-white shadow-md transition-all hover:bg-emerald-500 hover:shadow-lg active:scale-98"
            >
              Começar gratuitamente
              <ArrowRight className="size-5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
