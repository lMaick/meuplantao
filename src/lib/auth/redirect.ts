/** Keep authentication redirects on this application and avoid auth loops. */
export function safeNext(value?: string | string[]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/dashboard";
  const path = value.split(/[?#]/)[0];
  if (path === "/login" || path === "/cadastro") return "/dashboard";
  return value;
}

export function authCallbackUrl(origin: string, next: string): string {
  const parsed = new URL(origin);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Origem inválida para callback de autenticação");
  const url = new URL("/auth/callback", parsed);
  url.searchParams.set("next", safeNext(next));
  return url.toString();
}
