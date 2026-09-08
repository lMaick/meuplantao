import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNext } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) return NextResponse.redirect(new URL("/login?error=configuration", request.url));
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  const response = NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next") ?? undefined), request.url));
  const supabase = createServerClient(config.url, config.key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }) } });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  return response;
}
