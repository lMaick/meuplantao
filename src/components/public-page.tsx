import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

const BRAND_LOGO_SRC = "/brand/meuplantao-simbolo-oficial.png";

export function PublicPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-bold tracking-tight text-foreground transition-opacity hover:opacity-90"
          >
            <span className="grid size-9 place-items-center overflow-hidden rounded-xl bg-white shadow-xs ring-1 ring-border/60">
              <Image
                src={BRAND_LOGO_SRC}
                alt="MeuPlantão"
                width={36}
                height={36}
                className="size-9 object-contain"
                priority
              />
            </span>
            <span>MeuPlantão</span>
          </Link>
          <nav aria-label="Navegação pública" className="flex items-center gap-4 text-sm">
            <Link
              href="/login"
              className="flex min-h-[44px] items-center text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="flex min-h-[44px] items-center rounded-lg bg-primary px-3.5 py-2 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Criar conta
            </Link>
          </nav>
        </header>

        <article className="rounded-xl border bg-background p-6 shadow-sm sm:p-10">
          <p className="text-sm font-semibold text-primary">MeuPlantão</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">{intro}</p>

          <div className="mt-8 space-y-6 text-sm leading-7 text-foreground/90">{children}</div>

          <div className="mt-10 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-300 leading-relaxed">
            <strong>Aviso de transparência:</strong> Este documento descreve as práticas e termos
            atuais do produto para o período de testes e lançamento. Não constitui aconselhamento
            jurídico definitivo e está marcado para revisão e validação jurídica formal antes da
            disponibilização em escala comercial.
          </div>
        </article>

        <footer className="flex flex-wrap justify-center gap-x-6 gap-y-3 py-8 text-xs text-muted-foreground">
          <Link href="/privacidade" className="hover:text-foreground underline underline-offset-4">
            Política de Privacidade
          </Link>
          <Link href="/termos" className="hover:text-foreground underline underline-offset-4">
            Termos de Uso
          </Link>
          <Link href="/suporte" className="hover:text-foreground underline underline-offset-4">
            Suporte e Feedback
          </Link>
        </footer>
      </div>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold leading-6 text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
