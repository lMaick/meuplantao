export const DEFAULT_SITE_URL = "https://meuplantao.pro";

export function isProductionEnvironment(): boolean {
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
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const previewHost = process.env.VERCEL_URL?.trim();
  // MAI-139 (auditoria): em VERCEL_ENV=preview, VERCEL_URL tem precedência
  // sobre PRODUCTION_URL; nos demais ambientes a produção tem precedência.
  const isPreview = process.env.VERCEL_ENV?.trim() === "preview";
  const first = isPreview ? previewHost : prodHost;
  const second = isPreview ? prodHost : previewHost;
  if (first) return prefixHttpsIfMissing(first);
  if (second) return prefixHttpsIfMissing(second);
  return undefined;
}

function hasManualConfig(): boolean {
  const { site, app } = readManualSiteUrl();
  return Boolean(site || app);
}

/**
 * Resolução hierárquica da URL canônica:
 * a) NEXT_PUBLIC_SITE_URL (preferencial)
 * b) NEXT_PUBLIC_APP_URL (retrocompatível; warn se divergir de SITE_URL)
 * c) VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL (prefixando https://)
 * d) fallback padrão https://meuplantao.pro
 */
export function getSiteUrl(): string {
  const { site, app } = readManualSiteUrl();

  if (site) {
    const normalizedSite = normalizeSiteUrl(site);
    if (app) {
      try {
        const normalizedApp = normalizeSiteUrl(app);
        if (normalizedApp !== normalizedSite) {
          console.warn(
            "[MAI-139] NEXT_PUBLIC_SITE_URL e NEXT_PUBLIC_APP_URL divergem; usando NEXT_PUBLIC_SITE_URL como canônica.",
          );
        }
      } catch {
        console.warn(
          "[MAI-139] NEXT_PUBLIC_APP_URL inválida; usando NEXT_PUBLIC_SITE_URL como canônica.",
        );
      }
    }
    return normalizedSite;
  }

  if (app) return normalizeSiteUrl(app);

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
export function getCanonicalOrigin(requestUrl?: string): string {
  const canonical = getSiteUrl();

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
