"use client";

import Link from "next/link";
import { FormEvent, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

function EsqueciSenhaContent() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setLoading(true);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/redefinir-senha`;
      await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    } catch {
      // Intencionalmente suprimido para impedir a enumeração de contas
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold text-primary">MeuPlantão</p>
          <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
          <p className="text-sm text-muted-foreground">
            Informe seu e-mail para receber as instruções de recuperação.
          </p>
        </div>

        {errorParam === "link_expired" && !submitted && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
          >
            O link de recuperação de senha expirou ou é inválido. Solicite um novo link abaixo.
          </div>
        )}

        {submitted ? (
          <div className="space-y-5">
            <div
              role="status"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-300 space-y-2"
            >
              <p className="font-medium">Instruções enviadas</p>
              <p className="leading-relaxed">
                Se houver uma conta cadastrada com este e-mail, enviamos uma mensagem com o link seguro
                para redefinir sua senha. Verifique sua caixa de entrada e a pasta de spam.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => {
                setSubmitted(false);
                setEmail("");
              }}
            >
              Enviar para outro e-mail
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="recovery-email" className="text-sm font-medium">
                E-mail cadastrado
              </label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="medico@hospital.com.br"
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? "Enviando link..." : "Enviar link de recuperação"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Lembrou sua senha?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Voltar ao login
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

export default function EsqueciSenhaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-muted/40" />}>
      <EsqueciSenhaContent />
    </Suspense>
  );
}
