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

export const MACHINE_TO_MACHINE_PATHS = [
  "/api/webhooks/mercadopago",
  "/api/webhooks/mercadopago/ipn",
  "/api/csp-report",
] as const;

/**
 * MAI-151: rotas machine-to-machine (webhooks Mercado Pago + relatório CSP).
 * Chamadores server-to-server/browser-beacon sem sessão Supabase. A
 * autenticação/autorização vive nos handlers (HMAC x-signature, consulta
 * autenticada Mercado Pago, idempotência, rate limit, sanitização) — nunca
 * em cookie de sessão. Comparação exata: sem prefixo genérico `/api/*`.
 */
export function isMachineToMachineRoute(pathname: string): boolean {
  return (MACHINE_TO_MACHINE_PATHS as readonly string[]).includes(pathname);
}

export const PUBLIC_SEO_PATHS = ["/sitemap.xml"] as const;

/**
 * MAI-155: rota pública de SEO servida sem sessão (crawlers anônimos não têm
 * cookie Supabase). Classificação exata da rota `/sitemap.xml` — lista
 * separada da M2M (não é webhook/beacon e não entra em
 * MACHINE_TO_MACHINE_PATHS). O fast-path pula `auth.getUser` mas o
 * middleware continua aplicando o wrapper de headers (HSTS) sobre o response.
 */
export function isPublicSeoRoute(pathname: string): boolean {
  return (PUBLIC_SEO_PATHS as readonly string[]).includes(pathname);
}

export const PUBLIC_CONTENT_PATHS = ["/", "/privacidade", "/termos", "/suporte"] as const;

/**
 * MAI-160: páginas públicas de conteúdo servidas sem sessão (não precisam de
 * usuário para renderizar). Classificação exata — lista separada da M2M e do
 * SEO (não é webhook/beacon nem rota de crawler). O fast-path ocorre ANTES de
 * criar o client Supabase/chamar `auth.getUser`, mas o middleware continua
 * aplicando o wrapper de headers (HSTS) sobre o response. Sem prefixo
 * genérico: `/api/*`, dashboard, calendário, pagamentos e rotas autenticadas
 * nunca entram aqui. Login/cadastro/recovery dependem de sessão/redirect e
 * ficam fora deste fast-path.
 */
export function isPublicContentRoute(pathname: string): boolean {
  return (PUBLIC_CONTENT_PATHS as readonly string[]).includes(pathname);
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // MAI-151: fast-path M2M ANTES de qualquer Supabase Auth. Retorna
  // NextResponse.next sem criar client nem chamar auth.getUser, mas o
  // middleware ainda aplica o wrapper de headers (HSTS) sobre este response.
  if (isMachineToMachineRoute(pathname)) {
    return NextResponse.next({ request });
  }
  // MAI-155: mesmo fast-path para a rota pública exata de SEO
  // (/sitemap.xml via isPublicSeoRoute — lista separada da M2M, sem
  // duplicar a classificação M2M acima). Crawlers anônimos chegam ao
  // handler sem sessão; o middleware preserva o wrapper de headers (HSTS).
  if (isPublicSeoRoute(pathname)) {
    return NextResponse.next({ request });
  }
  // MAI-160: mesmo fast-path para páginas públicas de conteúdo
  // (`/` + `/privacidade` + `/termos` + `/suporte` via isPublicContentRoute —
  // lista separada da M2M e do SEO). Visitantes anônimos chegam ao handler
  // sem sessão e sem custo de Auth; o middleware preserva o wrapper de
  // headers (HSTS). ANTES de criar o client Supabase/chamar `auth.getUser`.
  if (isPublicContentRoute(pathname)) {
    return NextResponse.next({ request });
  }
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

  const isLandingPage = pathname === "/";
  const isAuthEntryPage = pathname === "/login" || pathname === "/cadastro" || pathname === "/esqueci-senha";
  const isPublicLegalOrSupport = pathname === "/privacidade" || pathname === "/termos" || pathname === "/suporte";
  const isPasswordResetPage = pathname === "/redefinir-senha";
  const isPublicAuthCallback = pathname === "/auth/callback";
  const isPublicMercadoPagoWebhook =
    pathname === "/api/webhooks/mercadopago" ||
    pathname === "/api/webhooks/mercadopago/ipn";
  // MAI-145: relatórios de violação CSP partem do browser sem sessão (ex.:
  // violações no /login); o endpoint tem proteção própria (rate limit,
  // validação, sem PII) e nunca exige autenticação — como os webhooks acima.
  const isPublicCspReport = pathname === "/api/csp-report";

  const isPublicAllowed =
    isLandingPage ||
    isAuthEntryPage ||
    isPublicLegalOrSupport ||
    isPasswordResetPage ||
    isPublicAuthCallback ||
    isPublicMercadoPagoWebhook ||
    isPublicCspReport;

  if (!user && !isPublicAllowed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const isSessionRecovery = pathname === "/login" && request.nextUrl.searchParams.get("reason") === "session-expired";
  if (user && isAuthEntryPage && !isSessionRecovery) {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next") ?? undefined), request.url));
  }

  return response;
}
