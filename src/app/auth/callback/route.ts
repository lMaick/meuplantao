import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNext } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next") ?? undefined);
  const isRecovery = next === "/redefinir-senha" || next.startsWith("/redefinir-senha");

  const handleAuthError = (errorReason = "oauth") => {
    if (isRecovery) {
      const url = new URL("/esqueci-senha", request.url);
      url.searchParams.set("error", "link_expired");
      return NextResponse.redirect(url);
    }
    const url = new URL("/login", request.url);
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
  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(config.url, config.key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }) } });
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return handleAuthError("oauth");
  } catch {
    return handleAuthError("oauth");
  }
  return response;
}
