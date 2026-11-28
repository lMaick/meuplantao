import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <section className="w-full max-w-xl rounded-2xl border bg-background p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Compass aria-hidden="true" className="size-8" />
        </div>
        <p className="text-sm font-semibold tracking-[0.2em] text-primary">ERRO 404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Esse endereço não existe ou foi alterado. Confira o link e volte para continuar usando o MeuPlantão.
        </p>
        <Link href="/" className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Voltar ao início
        </Link>
      </section>
    </main>
  );
}
