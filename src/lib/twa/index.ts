export const TWA_QUERY_PARAM = "origem";
export const TWA_QUERY_VALUE = "twa";
export const WEB_QUERY_VALUE = "web";
/**
 * Marca em `sessionStorage` (uma por aba), nunca em cookie ou `localStorage`:
 * a TWA divide cookies e armazenamento persistente com o Chrome do aparelho.
 * Uma marca persistente esconderia preço e checkout também no site comum.
 */
export const TWA_SESSION_KEY = "mp_origem";
export const ANDROID_PACKAGE_NAME = "pro.meuplantao.app";
export const TWA_ANDROID_REFERRER_ORIGIN = `android-app://${ANDROID_PACKAGE_NAME}`;

/** Lê a marca da aba; `false` se o armazenamento estiver bloqueado. */
export function hasTwaSessionMark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(TWA_SESSION_KEY) === TWA_QUERY_VALUE;
  } catch {
    return false;
  }
}

/**
 * Script inline anti-FOUC executado no `<head>` antes da primeira pintura.
 * Única fonte da detecção:
 * - `?origem=twa` (URL inicial da TWA), referrer exato do pacote Android ou
 *   marca já gravada nesta aba: grava a marca e define `data-twa="true"`.
 * - `?origem=web`: limpa a marca e remove `data-twa`.
 */
export function buildTwaBootstrapScript(): string {
  return `(() => {
  try {
    const root = document.documentElement;
    const origem = (new URLSearchParams(window.location.search).get("${TWA_QUERY_PARAM}") || "").trim().toLowerCase();
    if (origem === "${WEB_QUERY_VALUE}") {
      delete root.dataset.twa;
      try { window.sessionStorage.removeItem("${TWA_SESSION_KEY}"); } catch {}
      return;
    }
    const ref = (document.referrer || "").trim().toLowerCase();
    let isTwa = origem === "${TWA_QUERY_VALUE}" || ref === "${TWA_ANDROID_REFERRER_ORIGIN}" || ref.startsWith("${TWA_ANDROID_REFERRER_ORIGIN}/");
    if (!isTwa) {
      try { isTwa = window.sessionStorage.getItem("${TWA_SESSION_KEY}") === "${TWA_QUERY_VALUE}"; } catch {}
    }
    if (!isTwa) return;
    root.dataset.twa = "true";
    try { window.sessionStorage.setItem("${TWA_SESSION_KEY}", "${TWA_QUERY_VALUE}"); } catch {}
  } catch {}
})();`;
}
