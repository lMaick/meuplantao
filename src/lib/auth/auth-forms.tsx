"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { getClientOrigin, oauthProviderConfig } from "@/lib/auth/redirect";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  SIGNUP_SUCCESS_GENERIC_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  validatePasswordLength,
  mapLoginAuthError,
  mapSignupAuthError,
} from "@/lib/auth/password-policy";

type Mode = "login" | "signup";

export function AuthForm({ mode, next = "/dashboard", authOrigin }: { mode: Mode; next?: string; authOrigin: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "github" | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    // Guard client-side: exige min 8 caracteres apenas no signup, preservando login para senhas legadas
    if (mode === "signup") {
      const validation = validatePasswordLength(password);
      if (!validation.valid) {
        setError(validation.error ?? PASSWORD_MIN_LENGTH_MESSAGE);
        return;
      }
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

      if (result.error) {
        if (mode === "login") {
          setError(mapLoginAuthError(result.error));
        } else {
          const mapped = mapSignupAuthError(result.error);
          if (mapped.type === "message") {
            setMessage(mapped.text);
          } else {
            setError(mapped.text);
          }
        }
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage(SIGNUP_SUCCESS_GENERIC_MESSAGE);
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuthSignIn(provider: "google" | "github") {
    setError(null); setMessage(null); setOauthLoading(provider);
    try {
      const origin = getClientOrigin(authOrigin);
      const { error: oauthError } = await createClient().auth.signInWithOAuth(oauthProviderConfig(provider, origin, next));
      if (oauthError) setError("Não foi possível iniciar o acesso. Tente novamente.");
    } catch { setError(`Não foi possível iniciar o acesso com ${provider === "google" ? "Google" : "GitHub"}. Tente novamente.`); }
    finally { setOauthLoading(null); }
  }

  return (
    <div className="space-y-5" aria-busy={loading || oauthLoading !== null}>
      <Button type="button" variant="outline" className="h-11 w-full" disabled={loading || oauthLoading !== null} onClick={() => handleOAuthSignIn("google")}>{oauthLoading === "google" ? "Abrindo Google..." : "Continuar com Google"}</Button>
      <Button type="button" variant="outline" className="h-11 w-full" disabled={loading || oauthLoading !== null} onClick={() => handleOAuthSignIn("github")}>{oauthLoading === "github" ? "Abrindo GitHub..." : "Continuar com GitHub"}</Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div>
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">Senha</label>
          {mode === "login" && (
            <Link
              href="/esqueci-senha"
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Esqueceu a senha?
            </Link>
          )}
        </div>
        <input id="password" name="password" type="password" minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined} aria-describedby={mode === "signup" ? "password-help" : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
      {mode === "signup" && <p id="password-help" className="text-sm text-muted-foreground">Use pelo menos 8 caracteres. Podemos pedir a confirmação do seu e-mail antes do primeiro acesso.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-600">{message}</p>}
      {message && <Link href={`/login?next=${encodeURIComponent(next)}`} className="block py-2 text-sm font-medium underline">Já confirmei meu e-mail: entrar</Link>}
      <Button type="submit" className="h-11 w-full" disabled={loading}>
        {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
      </Button>
    </form>
    </div>
  );
}
