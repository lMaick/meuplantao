/** Keep authentication redirects on this application and avoid auth loops. */
export function safeNext(value?: string | string[]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/dashboard";
  const path = value.split(/[?#]/)[0];
  if (path === "/login" || path === "/cadastro" || path === "/esqueci-senha") return "/dashboard";
  return value;
}

/**
 * Validate the origin resolved by a Server Component and passed as a prop.
 * Never read window.location here: production aliases must keep the configured
 * canonical origin, while Preview origins are resolved from server env first.
 */
export function getClientOrigin(serverResolvedOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverResolvedOrigin);
  } catch {
    throw new Error("Origem inválida para callback de autenticação");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Origem inválida para callback de autenticação");
  }
  return parsed.origin;
}

export function authCallbackUrl(origin: string, next: string): string {
  const url = new URL("/auth/callback", getClientOrigin(origin));
  url.searchParams.set("next", safeNext(next));
  return url.toString();
}

export function oauthProviderConfig(provider: "google" | "github", origin: string, next: string) {
  return { provider, options: { redirectTo: authCallbackUrl(origin, next) } };
}
