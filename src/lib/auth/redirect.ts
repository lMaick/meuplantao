import { getCanonicalOrigin, isProductionEnvironment } from "../config/site-url";

/** Keep authentication redirects on this application and avoid auth loops. */
export function safeNext(value?: string | string[]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/dashboard";
  const path = value.split(/[?#]/)[0];
  if (path === "/login" || path === "/cadastro" || path === "/esqueci-senha") return "/dashboard";
  return value;
}

/**
 * MAI-139: em produção a origem do callback OAuth é SEMPRE a origem
 * canônica configurada (anti Host Header Poisoning); fora de produção
 * preserva a origem informada (dev local, previews e testes).
 */
function resolveAuthOrigin(origin: string): string {
  if (isProductionEnvironment()) return getCanonicalOrigin(origin);
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
