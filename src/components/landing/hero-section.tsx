import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Smartphone, TrendingUp } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background pt-12 pb-16 md:pt-20 md:pb-24">
      {/* Subtle architectural background accents (not AI purple blobs!) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(var(--foreground) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
        {/* Pill Badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-xs mb-8">
          <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Feito por quem entende a rotina pesada de plantões</span>
        </div>

        {/* Main Title */}
        <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:leading-[1.1]">
          Controle financeiro inteligente para quem{" "}
          <span className="text-emerald-600">
            vive de plantão
          </span>
          .
        </h1>

        {/* Lead description */}
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl leading-relaxed">
          Você sabe com certeza quanto tem para receber este mês? Se precisou pensar, o MeuPlantão é para você.
          Controle plantões em múltiplos hospitais, identifique repasses atrasados e receba até o último centavo.
        </p>

        {/* Actions */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/cadastro"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-7 text-base font-bold text-white shadow-md transition-all hover:bg-emerald-500 hover:shadow-lg sm:w-auto active:scale-98"
          >
            Começar Gratuitamente
            <ArrowRight className="size-5" />
          </Link>
          <Link
            href="#demonstracao"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-7 text-base font-semibold text-muted-foreground shadow-xs transition-all hover:bg-muted hover:text-foreground sm:w-auto"
          >
            Ver Demonstração Interativa
          </Link>
        </div>

        {/* Trust Badges */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <span>Sem cartão no cadastro</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Smartphone className="size-4 text-emerald-600" />
            <span>100% otimizado para celular</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span>Seus dados isolados e seguros</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-4 text-emerald-600" />
            <span>Status calculado automaticamente</span>
          </div>
        </div>
      </div>
    </section>
  );
}
