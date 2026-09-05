import { safeNext } from "@/lib/auth/redirect";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

function createRequestClient(request: NextRequest, response: NextResponse, config: { url: string; key: string }) {
  return createServerClient(
    config.url,
    config.key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );
}

export async function updateSession(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return new NextResponse(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MeuPlantao — configuração pendente</title></head>
<body><main><h1>MeuPlantao temporariamente indisponível</h1>
<p>A configuração do Supabase está ausente ou inválida.</p>
<p>Para executar localmente, preencha <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no arquivo <code>.env.local</code>, seguindo o <code>README.md</code>, e reinicie o servidor. Se estiver usando um build, gere-o novamente.</p>
</main></body></html>`, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const response = NextResponse.next({ request });
  const supabase = createRequestClient(request, response, config);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPage = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/cadastro";

  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const isSessionRecovery = request.nextUrl.pathname === "/login" && request.nextUrl.searchParams.get("reason") === "session-expired";
  if (user && isAuthPage && !isSessionRecovery) {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next") ?? undefined), request.url));
  }

  return response;
}
