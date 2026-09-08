import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNext } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next") ?? undefined);
  const loginWithError = () => {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "oauth");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };
  const config = getSupabaseConfig();
  if (!config) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "configuration");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  if (request.nextUrl.searchParams.has("error")) return loginWithError();
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return loginWithError();
  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(config.url, config.key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }) } });
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return loginWithError();
  } catch {
    return loginWithError();
  }
  return response;
}
