export const DEFAULT_SITE_URL = "https://meuplantao.pro";

/**
 * Retorna a URL base canônica do MeuPlantão, garantindo normalização determinística:
 * - Fallback canônico padrão: https://meuplantao.pro
 * - Remove espaços em branco
 * - Remove trailing slash (/ no final), evitando rotas com '//'
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const raw = envUrl || DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, "");
}
