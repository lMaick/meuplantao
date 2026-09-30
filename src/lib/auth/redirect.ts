import { getCanonicalOrigin, isPreviewEnvironment, isProductionEnvironment } from "../config/site-url";

/** Keep authentication redirects on this application and avoid auth loops. */
export function safeNext(value?: string | string[]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/dashboard";
  const path = value.split(/[?#]/)[0];
  if (path === "/login" || path === "/cadastro" || path === "/esqueci-senha") return "/dashboard";
  return value;
}

/**
 * MAI-139: resolução segura de origem para callbacks de autenticação:
 * - No browser (`typeof window !== "undefined"`): usa a origem do navegador
 *   (garantindo suporte a Vercel Previews, dev e produção sem cross-origin redirect).
 * - Em preview Vercel no servidor (`VERCEL_ENV=preview`): usa a URL confiável do preview.
 * - Em produção no servidor: SEMPRE usa a origem canônica configurada (anti Host Header Injection).
 * - Fora de produção (dev local e testes): respeita a origem fornecida.
 */
function resolveAuthOrigin(origin: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      const candidate = origin || window.location.origin;
      const parsed = new URL(candidate);
      if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash) {
        return parsed.origin;
      }
    } catch {
      // fallback se origin for malformada
    }
  }

  if (isPreviewEnvironment()) {
    return getCanonicalOrigin();
  }

  if (isProductionEnvironment()) {
    return getCanonicalOrigin(origin);
  }

  return origin;
}

export function authCallbackUrl(origin: string, next: string): string {
  const parsed = new URL(resolveAuthOrigin(origin));
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Origem inválida para callback de autenticação");
  const url = new URL("/auth/callback", parsed);
  url.searchParams.set("next", safeNext(next));
  return url.toString();
}

export function oauthProviderConfig(provider: "google" | "github", origin: string, next: string) {
  return { provider, options: { redirectTo: authCallbackUrl(origin, next) } };
}
