import { NextResponse, type NextRequest } from "next/server";
import { isMachineToMachineRoute, isPublicContentRoute, isPublicSeoRoute, updateSession } from "@/lib/auth/session";
import { getHstsValue, HSTS_HEADER, shouldSendHsts } from "@/lib/security/hsts";

function requestHost(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.hostname ??
    ""
  );
}

function requestProto(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.nextUrl.protocol;
}

export async function middleware(request: NextRequest) {
  // MAI-151: classificação M2M ANTES de qualquer Supabase Auth. Rotas
  // machine-to-machine (/api/webhooks/mercadopago, .../ipn, /api/csp-report)
  // pulam updateSession/auth.getUser por não terem sessão; o wrapper de
  // headers (HSTS) abaixo continua aplicado. Sem bypass genérico /api/* —
  // a lista exata vive em isMachineToMachineRoute.
  // MAI-155: mesmo fast-path para a rota pública exata de SEO
  // (/sitemap.xml, via isPublicSeoRoute — lista separada da M2M); crawlers
  // anônimos chegam ao handler sem sessão e sem 307/308.
  // MAI-160: mesmo fast-path para páginas públicas de conteúdo
  // (`/`, `/privacidade`, `/termos`, `/suporte` via isPublicContentRoute —
  // lista exata separada da M2M e do SEO); visitantes anônimos chegam ao
  // handler sem criar client Supabase e sem `auth.getUser`. Login/cadastro/
  // recovery dependem de sessão e ficam fora deste fast-path.
  const response =
    isMachineToMachineRoute(request.nextUrl.pathname) ||
    isPublicSeoRoute(request.nextUrl.pathname) ||
    isPublicContentRoute(request.nextUrl.pathname)
      ? NextResponse.next({ request })
      : await updateSession(request);
  // MAI-146: HSTS somente no host de produção via HTTPS. Localhost, preview
  // (*.vercel.app), staging e HTTP nunca recebem o header; o redirect
  // HTTP→HTTPS é papel da Vercel/edge. `next.config.ts` propositalmente NÃO
  // emite HSTS estático (build não distingue host).
  if (shouldSendHsts({ hostname: requestHost(request), proto: requestProto(request) })) {
    response.headers.set(HSTS_HEADER, getHstsValue());
  }
  return response;
}

export const config = {
  // MAI-159: exact reserved anonymous path `release-proof-<40-hex>.json`
  // (production release attestation served from `public/`). Nothing else
  // bypasses through this alternative; every other route keeps the previous
  // behavior.
  matcher: ["/((?!robots\\.txt$|release-proof-[0-9a-fA-F]{40}\\.json$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
