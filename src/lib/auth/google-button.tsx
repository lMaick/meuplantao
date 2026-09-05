"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { OAUTH_PROVIDER, buildOAuthCallbackUrl, getPublicSiteOrigin } from "@/lib/auth/oauth";

type Mode = "login" | "signup";

export function GoogleAuthButton({ mode, next = "/dashboard" }: { mode: Mode; next?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const callbackUrl = buildOAuthCallbackUrl(getPublicSiteOrigin(window.location.origin)) + `?next=${encodeURIComponent(next)}`;
      const result = await supabase.auth.signInWithOAuth({
        provider: OAUTH_PROVIDER,
        options: { redirectTo: callbackUrl },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      // signInWithOAuth returns the provider URL when skipBrowserRedirect is omitted;
      // the supabase-js client performs the redirect automatically. Nothing else to do.
    } catch {
      setError("Não foi possível iniciar o login com Google. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-11 w-full" onClick={handleClick} disabled={loading}>
        {loading ? "Aguarde..." : mode === "login" ? "Entrar com Google" : "Cadastrar com Google"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
