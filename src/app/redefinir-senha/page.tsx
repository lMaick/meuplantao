"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

import { verifyRecoveryClaims } from "@/lib/auth/recovery";
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordReset,
  mapPasswordUpdateError,
} from "@/lib/auth/password-policy";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isRecoveryContext, setIsRecoveryContext] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    // 1. Caminho rápido: escuta o evento PASSWORD_RECOVERY emitido pelo Supabase Auth
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!isMounted) return;

      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryContext(true);
        setChecking(false);
      }
    });

    // 2. Fallback confiável para o fluxo PKCE/SSR:
    // inspeciona as claims verificadas do JWT via getClaims() sem confiar em session.user.amr
    async function checkClaims() {
      try {
        const isRecovery = await verifyRecoveryClaims(supabase.auth);
        if (!isMounted) return;

        if (isRecovery) {
          setIsRecoveryContext(true);
        }
      } catch {
        // Falha ao obter claims; sessão permanece não autorizada
      } finally {
        if (isMounted) {
          setChecking(false);
        }
      }
    }

    checkClaims();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const validation = validatePasswordReset(password, confirmPassword);
    if (!validation.valid) {
      setError(validation.error ?? "Erro ao validar nova senha.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(mapPasswordUpdateError(updateError));
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1800);
    } catch {
      setError("Erro de comunicação ao salvar a nova senha. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
        <section className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <div className="space-y-2 text-center">
            <div className="mx-auto h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="mx-auto h-7 w-48 animate-pulse rounded bg-muted" />
            <div className="mx-auto h-4 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-4">
            <div className="h-11 w-full animate-pulse rounded bg-muted" />
            <div className="h-11 w-full animate-pulse rounded bg-muted" />
            <div className="h-11 w-full animate-pulse rounded bg-muted" />
          </div>
        </section>
      </main>
    );
  }

  if (!isRecoveryContext) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
        <section className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm sm:p-8">
          <div className="space-y-2 text-center">
            <p className="text-sm font-semibold text-primary">MeuPlantão</p>
            <h1 className="text-2xl font-semibold tracking-tight">Link expirado</h1>
            <p className="text-sm text-muted-foreground">
              O link de recuperação é inválido ou já expirou.
            </p>
          </div>

          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300 leading-relaxed"
          >
            Por motivos de segurança, o link de recuperação só pode ser usado uma vez e tem validade
            limitada. Solicite um novo link para continuar.
          </div>

          <div className="space-y-3">
            <Link
              href="/esqueci-senha"
              className="flex h-11 w-full items-center justify-center rounded-md bg-primary font-medium text-primary-foreground hover:bg-primary/90"
            >
              Solicitar novo link de recuperação
            </Link>
            <Link
              href="/login"
              className="flex h-11 w-full items-center justify-center rounded-md border border-input bg-background font-medium hover:bg-accent"
            >
              Voltar ao login
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm sm:p-8">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold text-primary">MeuPlantão</p>
          <h1 className="text-2xl font-semibold tracking-tight">Definir nova senha</h1>
          <p className="text-sm text-muted-foreground">
            Escolha uma nova senha segura para acessar sua conta.
          </p>
        </div>

        {success ? (
          <div className="space-y-5">
            <div
              role="status"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-300 space-y-1 text-center"
            >
              <p className="font-semibold">Senha atualizada com sucesso!</p>
              <p className="text-xs">Redirecionando para a sua central...</p>
            </div>
            <Button
              type="button"
              className="h-11 w-full"
              onClick={() => {
                router.push("/dashboard");
                router.refresh();
              }}
            >
              Ir para o painel agora
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="new-password" className="text-sm font-medium">
                Nova senha
              </label>
              <input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                Confirmar nova senha
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repita a nova senha"
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? "Salvando nova senha..." : "Salvar nova senha"}
            </Button>
          </form>
        )}

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
