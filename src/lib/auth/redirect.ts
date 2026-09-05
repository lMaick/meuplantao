/** Keep authentication redirects on this application and avoid auth loops. */
export function safeNext(value?: string | string[]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return "/dashboard";
  const path = value.split(/[?#]/)[0];
  if (path === "/login" || path === "/cadastro") return "/dashboard";
  return value;
}
