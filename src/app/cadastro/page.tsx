import type { Metadata } from "next";
import { safeNext } from "@/lib/auth/redirect";
import Link from "next/link";
import { AuthForm } from "@/lib/auth/auth-forms";

export const metadata: Metadata = {
  title: "Criar Conta | MeuPlantão",
  description: "Organize seus plantões em um só lugar.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CadastroPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold text-primary">MeuPlantão</p>
          <h1 className="text-2xl font-semibold tracking-tight">Crie sua conta</h1>
          <p className="text-sm text-muted-foreground">Organize seus plantões em um só lugar.</p>
        </div>
        <AuthForm mode="signup" next={next} />
        <p className="text-center text-xs text-muted-foreground leading-relaxed">
          Ao criar sua conta, você concorda com nossos{" "}
          <Link href="/termos" className="font-medium text-foreground underline underline-offset-4">
            Termos de Uso
          </Link>{" "}
          e{" "}
          <Link href="/privacidade" className="font-medium text-foreground underline underline-offset-4">
            Política de Privacidade
          </Link>
          .
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Já tem uma conta?{" "}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Entrar
          </Link>
        </p>
        <nav
          aria-label="Informações públicas"
          className="flex flex-wrap justify-center gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground"
        >
          <Link href="/privacidade" className="underline underline-offset-4">
            Privacidade
          </Link>
          <Link href="/termos" className="underline underline-offset-4">
            Termos
          </Link>
          <Link href="/suporte" className="underline underline-offset-4">
            Suporte
          </Link>
        </nav>
      </section>
    </main>
  );
}
