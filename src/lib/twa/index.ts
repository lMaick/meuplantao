export const TWA_QUERY_PARAM = "origem";
export const TWA_QUERY_VALUE = "twa";
export const WEB_QUERY_VALUE = "web";
export const TWA_COOKIE_NAME = "mp_origem";
export const TWA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 ano
export const ANDROID_PACKAGE_NAME = "pro.meuplantao.app";
export const TWA_ANDROID_REFERRER_ORIGIN = `android-app://${ANDROID_PACKAGE_NAME}`;

export type TwaOriginParam = "twa" | "web" | null;

export function resolveTwaOriginParam(
  searchParams: URLSearchParams | null | undefined,
): TwaOriginParam {
  const raw = searchParams?.get(TWA_QUERY_PARAM)?.trim().toLowerCase();
  if (raw === TWA_QUERY_VALUE) return "twa";
  if (raw === WEB_QUERY_VALUE) return "web";
  return null;
}

export function parseCookieValue(
  cookieHeader: string | null | undefined,
  cookieName: string = TWA_COOKIE_NAME,
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== cookieName) continue;
    const rawVal = part.slice(eqIdx + 1).trim();
    try {
      return decodeURIComponent(rawVal);
    } catch {
      return rawVal;
    }
  }
  return null;
}

export function isAndroidTwaReferrer(referrer: string | null | undefined): boolean {
  if (!referrer) return false;
  const normalized = referrer.trim().toLowerCase();
  return (
    normalized === TWA_ANDROID_REFERRER_ORIGIN ||
    normalized.startsWith(`${TWA_ANDROID_REFERRER_ORIGIN}/`)
  );
}

export interface TwaContextInput {
  searchParams?: URLSearchParams | null;
  cookieValue?: string | null;
  cookieHeader?: string | null;
  referrer?: string | null;
}

export function isTwaContext(input: TwaContextInput): boolean {
  const originParam = resolveTwaOriginParam(input.searchParams);
  if (originParam === "web") return false;
  if (originParam === "twa") return true;

  const cookie =
    input.cookieValue ?? parseCookieValue(input.cookieHeader, TWA_COOKIE_NAME);
  if (cookie?.trim().toLowerCase() === TWA_QUERY_VALUE) return true;

  if (isAndroidTwaReferrer(input.referrer)) return true;

  return false;
}

export function getTwaCookieOptions(secure: boolean) {
  return {
    path: "/",
    maxAge: TWA_COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    secure,
    httpOnly: false,
  };
}

export function getClearTwaCookieOptions(secure: boolean) {
  return {
    path: "/",
    maxAge: 0,
    sameSite: "lax" as const,
    secure,
    httpOnly: false,
  };
}

/**
 * Script inline anti-FOUC executado no `<head>` antes da primeira pintura:
 * - Se `?origem=twa` ou referrer `android-app://pro.meuplantao.app`, grava o cookie `mp_origem=twa`
 *   e define `document.documentElement.dataset.twa = "true"`.
 * - Se o cookie `mp_origem=twa` já existir, aplica `data-twa="true"` imediatamente.
 * - Se `?origem=web`, limpa o cookie e remove `data-twa`.
 */
export function buildTwaBootstrapScript(): string {
  return `(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const origem = (params.get("${TWA_QUERY_PARAM}") || "").trim().toLowerCase();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    if (origem === "${WEB_QUERY_VALUE}") {
      document.cookie = "${TWA_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax" + secure;
      delete document.documentElement.dataset.twa;
      return;
    }
    const hasCookie = document.cookie.split(";").some((entry) => {
      const idx = entry.indexOf("=");
      if (idx === -1) return false;
      return entry.slice(0, idx).trim() === "${TWA_COOKIE_NAME}" && entry.slice(idx + 1).trim().toLowerCase() === "${TWA_QUERY_VALUE}";
    });
    const ref = (document.referrer || "").trim().toLowerCase();
    const isAndroidRef = ref === "${TWA_ANDROID_REFERRER_ORIGIN}" || ref.startsWith("${TWA_ANDROID_REFERRER_ORIGIN}/");
    if (origem === "${TWA_QUERY_VALUE}" || isAndroidRef) {
      document.cookie = "${TWA_COOKIE_NAME}=${TWA_QUERY_VALUE}; path=/; max-age=${TWA_COOKIE_MAX_AGE}; SameSite=Lax" + secure;
      document.documentElement.dataset.twa = "true";
    } else if (hasCookie) {
      document.documentElement.dataset.twa = "true";
    }
  } catch {}
})();`;
}
