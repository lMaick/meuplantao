import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { getCanonicalOrigin, isPreviewEnvironment, isProductionEnvironment } from "@/lib/config/site-url";
import { safeNext } from "@/lib/auth/redirect";

/**
 * MAI-139: em produção e previews Vercel os redirects do callback usam
 * a origem canônica confiável (anti Host Header Injection);
 * fora de produção preserva a origem da request (dev local e testes).
 */
function callbackBase(requestUrl: string): string {
  if (isPreviewEnvironment()) return getCanonicalOrigin();
  if (isProductionEnvironment()) return getCanonicalOrigin(requestUrl);
  return requestUrl;
}

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next") ?? undefined);
  const isRecovery = next === "/redefinir-senha" || next.startsWith("/redefinir-senha");
  const base = callbackBase(request.url);

  const handleAuthError = (errorReason = "oauth") => {
    if (isRecovery) {
      const url = new URL("/esqueci-senha", base);
      url.searchParams.set("error", "link_expired");
      return NextResponse.redirect(url);
    }
    const url = new URL("/login", base);
    url.searchParams.set("error", errorReason);
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  const config = getSupabaseConfig();
  if (!config) {
    return handleAuthError("configuration");
  }
  if (request.nextUrl.searchParams.has("error")) return handleAuthError("oauth");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return handleAuthError("oauth");
  const response = NextResponse.redirect(new URL(next, base));
  const supabase = createServerClient(config.url, config.key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }) } });
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return handleAuthError("oauth");
  } catch {
    return handleAuthError("oauth");
  }
  return response;
}
