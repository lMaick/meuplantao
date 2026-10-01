/**
 * Strict-Transport-Security para o domínio de produção (MAI-146).
 *
 * Fonte única do HSTS. O middleware (`src/middleware.ts`) consome
 * `shouldSendHsts()` + `getHstsValue()` para emitir o header SOMENTE no host
 * de produção via HTTPS. Nenhuma outra camada emite HSTS (em particular,
 * `next.config.ts` NÃO emite HSTS estático para não vazar para
 * localhost/preview — headers de build são estáticos e não distinguem host).
 *
 * Decisões (ver `docs/operations/hsts.md`):
 * - `max-age` inicial conservador: 86400 (24h). Curto o bastante para
 *   permitir rollback sem prender browsers por meses; longo o bastante para
 *   ter valor real. Aumentos futuros (ex.: 31536000) são follow-ups dedicados.
 * - `includeSubDomains` DESABILITADO por padrão: nem todos os subdomínios
 *   foram auditados quanto a HTTPS integral (staging, previews, apex vs www).
 * - `preload` DESABILITADO por padrão: exige `max-age >= 31536000` +
 *   `includeSubDomains` + submissão em hstspreload.org (quase irreversível
 *   no curto prazo). Avaliar separadamente após observação.
 * - Vercel já redireciona HTTP → HTTPS no edge; HSTS só é enviado sobre
 *   HTTPS (RFC 6797: browsers ignoram HSTS sobre HTTP) e nunca em
 *   localhost/preview/domínios alternativos.
 */

export const HSTS_HEADER = "Strict-Transport-Security";

/** max-age inicial conservador em segundos (24h). */
export const HSTS_INITIAL_MAX_AGE_SECONDS = 86400;

/** Mínimo exigido pelo programa hstspreload.org. */
export const HSTS_PRELOAD_MIN_MAX_AGE_SECONDS = 31536000;

/** Hosts de produção que recebem HSTS (apex + www). */
export const DEFAULT_PRODUCTION_HSTS_HOSTS: readonly string[] = [
  "meuplantao.pro",
  "www.meuplantao.pro",
];

export interface HstsOptions {
  maxAge?: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}

export interface HstsRequestContext {
  hostname?: string | null;
  proto?: string | null;
  allowedHosts?: readonly string[];
}

/** Normaliza hostname: trim + lowercase + remove porta e ponto final. */
export function normalizeHstsHostname(raw: string | null | undefined): string {
  if (!raw) return "";
  let host = raw.trim().toLowerCase();
  // Remove porta (inclui [::1]:3000). IPv6 entre colchetes: corta após `]`.
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) host = host.slice(0, end + 1);
  } else if (host.includes(":")) {
    host = host.split(":")[0] ?? "";
  }
  if (host.endsWith(".") && host.length > 1) host = host.slice(0, -1);
  return host;
}

/** Normaliza protocolo: `https:`/`https` → `https`. */
export function normalizeHstsProto(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/:$/, "");
}

/**
 * Monta o valor do header. Padrão = política inicial conservadora
 * (`max-age=86400`, sem `includeSubDomains`, sem `preload`).
 *
 * `preload=true` exige `includeSubDomains=true` e
 * `maxAge >= 31536000` (requisito do hstspreload.org); violação lança erro
 * para impedir submissão acidental com política curta.
 */
export function buildHstsValue(options: HstsOptions = {}): string {
  const maxAge = options.maxAge ?? HSTS_INITIAL_MAX_AGE_SECONDS;
  if (!Number.isInteger(maxAge) || maxAge <= 0) {
    throw new Error("HSTS max-age inválido (exige inteiro positivo em segundos)");
  }
  const includeSubDomains = options.includeSubDomains ?? false;
  const preload = options.preload ?? false;
  if (preload && (!includeSubDomains || maxAge < HSTS_PRELOAD_MIN_MAX_AGE_SECONDS)) {
    throw new Error(
      "HSTS preload exige includeSubDomains e max-age >= 31536000 (hstspreload.org)",
    );
  }
  let value = `max-age=${maxAge}`;
  if (includeSubDomains) value += "; includeSubDomains";
  if (preload) value += "; preload";
  return value;
}

/** Valor efetivo emitido em produção (política inicial conservadora). */
export function getHstsValue(): string {
  return buildHstsValue();
}

/** Verdadeiro somente para os hosts de produção (apex + www). */
export function isProductionHstsHost(
  hostname: string | null | undefined,
  allowedHosts: readonly string[] = DEFAULT_PRODUCTION_HSTS_HOSTS,
): boolean {
  const normalized = normalizeHstsHostname(hostname);
  if (!normalized) return false;
  return allowedHosts.some((allowed) => normalizeHstsHostname(allowed) === normalized);
}

/**
 * Decide se o HSTS deve ser enviado para a request:
 * - host ∈ produção (apex/www) E
 * - protocolo == https (HSTS sobre HTTP é ignorado pelo browser e não deve
 *   ser emitido; o redirect HTTP→HTTPS é papel da Vercel/edge).
 *
 * Localhost, 127.0.0.1, ::1, *.vercel.app, staging e domínios alternativos
 * nunca satisfazem a primeira condição.
 */
export function shouldSendHsts(context: HstsRequestContext): boolean {
  const proto = normalizeHstsProto(context.proto);
  if (proto !== "https") return false;
  return isProductionHstsHost(context.hostname, context.allowedHosts);
}
