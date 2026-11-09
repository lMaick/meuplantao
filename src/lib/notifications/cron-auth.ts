import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autorização do Vercel Cron: `Authorization: Bearer ${CRON_SECRET}`.
 * Fail-closed: sem segredo configurado ou com valor diferente, nega.
 * Compara digests SHA-256 em tempo constante (tamanho fixo, sem vazar comprimento).
 */
export function isCronAuthorized(authorizationHeader: string | null | undefined, secret: string | null | undefined): boolean {
  const expected = (secret ?? "").trim();
  if (!expected) return false;
  const header = authorizationHeader ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length).trim();
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O token de descadastro é um UUID; qualquer outra coisa nem chega ao banco. */
export function isWellFormedUnsubscribeToken(token: unknown): token is string {
  return typeof token === "string" && UUID.test(token);
}
