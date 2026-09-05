import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { resolveOAuthNext } from "@/lib/auth/oauth";

// Handle the redirect Google sends back after the user accepts the OAuth prompt.
//
// The route exchanges the one-time ?code=... for a session cookie set by
// supabase-js/ssr, then redirects to the safe `next` path (defaults to /dashboard).
//
// The handler runs in a request context, so we cannot reuse the singleton
// server client: we need a per-request instance whose cookie writes are applied
// to the NextResponse we return. Failing to do so drops the session.
export async function GET(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return new NextResponse("Supabase não configurado.", { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? undefined;
  const next = resolveOAuthNext(nextParam);
  const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const target = new URL(next, url.origin);

  if (errorParam) {
    target.searchParams.set("reason", "oauth-denied");
    return NextResponse.redirect(target);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const response = NextResponse.redirect(target);
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookies) {
        cookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    target.searchParams.set("reason", "oauth-error");
    return NextResponse.redirect(target);
  }

  return response;
}
