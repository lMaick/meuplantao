export const DEFAULT_SITE_URL = "https://meuplantao.pro";

export function isPreviewEnvironment(): boolean {
  return process.env.VERCEL_ENV?.trim() === "preview";
}

export function isProductionEnvironment(): boolean {
  if (isPreviewEnvironment()) return false;
  return (
    process.env.VERCEL_ENV?.trim() === "production" ||
    process.env.NODE_ENV?.trim() === "production"
  );
}

function isLocalhostHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function prefixHttpsIfMissing(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Normaliza e valida uma origem candidata a URL canônica.
 * - trim + remoção de trailing slashes múltiplos
 * - rejeita delimitadores vazios de credenciais, query e fragmento
 *   (ex.: "https://x.pro@", "https://x.pro?", "https://x.pro#")
 * - rejeita protocolo diferente de http/https (ex.: javascript:, data:)
 * - em produção exige https
 * - rejeita credenciais embutidas, paths além de "/", query e fragmento
 * - retorna `parsed.origin` normalizado (sem trailing slash)
 */
export function normalizeSiteUrl(raw: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("URL canônica vazia");
  if (/[@?#]$/.test(trimmed)) throw new Error("URL canônica inválida");
  // MAI-139 (auditoria): qualquer "@" indica userinfo vazio ou embutido
  // (ex.: "https://@example.com"); origem canônica nunca contém "@".
  if (trimmed.includes("@")) throw new Error("URL canônica inválida");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("URL canônica inválida");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL canônica inválida");
  }
  if (isProductionEnvironment() && parsed.protocol !== "https:") {
    throw new Error("URL canônica em produção deve usar https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL canônica inválida");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("URL canônica inválida");
  }
  return parsed.origin;
}

function readManualSiteUrl(): { site?: string; app?: string } {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim() || undefined;
  return {
    site: site ? site : undefined,
    app: app ? app : undefined,
  };
}

function readVercelFallback(): string | undefined {
  const deploymentHost = process.env.VERCEL_URL?.trim();
  return deploymentHost ? prefixHttpsIfMissing(deploymentHost) : undefined;
}

function hasManualConfig(): boolean {
  const { site, app } = readManualSiteUrl();
  return Boolean(site || app);
}

/**
 * Resolve the canonical public origin.
 * - Vercel Preview uses its deployment-specific VERCEL_URL.
 * - Production requires an explicit canonical URL (NEXT_PUBLIC_SITE_URL or the
 *   legacy NEXT_PUBLIC_APP_URL); Vercel's production hostname is not canonical config.
 * - Development may use VERCEL_URL or the documented default.
 */
export function getSiteUrl(options?: { requireConfig?: boolean }): string {
  if (isPreviewEnvironment()) {
    const previewHost = process.env.VERCEL_URL?.trim();
    if (!previewHost) {
      throw new Error('Missing required configuration: VERCEL_URL for Preview deployment');
    }
    return normalizeSiteUrl(prefixHttpsIfMissing(previewHost));
  }

  const { site, app } = readManualSiteUrl();

  if (site) {
    const normalizedSite = normalizeSiteUrl(site);
    if (app) {
      try {
        const normalizedApp = normalizeSiteUrl(app);
        if (normalizedApp !== normalizedSite) {
          console.warn(
            '[MAI-139] NEXT_PUBLIC_SITE_URL e NEXT_PUBLIC_APP_URL divergem; usando NEXT_PUBLIC_SITE_URL como canônica.',
          );
        }
      } catch {
        console.warn(
          '[MAI-139] NEXT_PUBLIC_APP_URL inválida; usando NEXT_PUBLIC_SITE_URL como canônica.',
        );
      }
    }
    return normalizedSite;
  }

  if (app) return normalizeSiteUrl(app);

  const mustRequire = options?.requireConfig === true || isProductionEnvironment();
  if (mustRequire) {
    throw new Error(
      'Configuração ausente: URL pública do MeuPlantão não configurada em ambiente de produção (defina NEXT_PUBLIC_SITE_URL)',
    );
  }

  const vercel = readVercelFallback();
  if (vercel) return normalizeSiteUrl(vercel);
  return DEFAULT_SITE_URL;
}
/**
 * Origem canônica segura para SEO, Mercado Pago e auth.
 * - Em produção: SEMPRE retorna a origem configurada; NUNCA deriva de
 *   `requestUrl` (proteção contra Host Header Poisoning).
 * - Fora de produção: se não houver configuração manual e `requestUrl`
 *   for localhost (dev local), permite a origem da request para testes.
 */
export function getCanonicalOrigin(requestUrl?: string, options?: { requireConfig?: boolean }): string {
  const canonical = getSiteUrl(options);

  if (!requestUrl) return canonical;

  if (isProductionEnvironment()) return canonical;

  // Dev/teste: sem config manual, permite localhost da request.
  if (!hasManualConfig()) {
    try {
      const trimmed = requestUrl.trim();
      const parsed = new URL(trimmed);
      if (!["http:", "https:"].includes(parsed.protocol)) return canonical;
      if (parsed.username || parsed.password || parsed.search || parsed.hash) return canonical;
      if (isLocalhostHostname(parsed.hostname)) return parsed.origin;
    } catch {
      return canonical;
    }
  }

  return canonical;
}
