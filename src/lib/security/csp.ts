/**
 * Content-Security-Policy com promoção gradual para modo efetivo (MAI-145,
 * base MAI-133).
 *
 * Fonte única da política CSP. `next.config.ts` consome `getCspHeaders()` para
 * emitir sempre `Content-Security-Policy-Report-Only` e, somente quando
 * `CSP_ENFORCE=true`, também o header efetivo `Content-Security-Policy` com o
 * MESMO valor. Nenhuma outra camada emite headers CSP.
 *
 * Mapa de origens reais (justificativa por diretiva — auditoria MAI-145, sem
 * novas origens em relação à MAI-133):
 * - Next.js / App Router + assets same-origin: `self` em todas as diretivas de
 *   busca; `script-src` + `unsafe-inline` (script anti-FOUC de tema em
 *   `src/app/layout.tsx` + runtime inline do Next.js); `style-src` +
 *   `unsafe-inline` (estilos inline injetados pelo Next.js/Tailwind).
 *   `unsafe-eval` NUNCA em produção — liberado apenas fora de produção para o
 *   HMR/overlay do `next dev`.
 * - Supabase: origem derivada de `NEXT_PUBLIC_SUPABASE_URL` (REST/Auth/Storage)
 *   + equivalente `wss:` (Realtime). Incluída em `connect-src` somente quando a
 *   variável está configurada e válida. Auth por senha e `getUser`/RPCs usam
 *   essa origem; OAuth (`signInWithOAuth` google/github) é navegação top-level
 *   (sem fetch adicional, fora do escopo de `connect-src`/`form-action`).
 * - Mercado Pago: o browser nunca chama a API diretamente (proxy same-origin
 *   `/api/mercadopago/*`, coberto por `connect-src 'self'`). O checkout usa
 *   navegacao top-level via `window.location.href = payload.init_point`
 *   (`src/components/subscription/subscription-card.tsx`), nao submissao de
 *   formulario - portanto nenhuma origem Mercado Pago e exigida em `form-action`,
 *   que permanece `'self'`; nenhum `iframe` de terceiros e usado, por isso
 *   `frame-src` permanece `self`. O retorno do checkout é navegação top-level
 *   de volta ao same-origin.
 * - Sentry: `@sentry/nextjs` é empacotado no bundle (sem script externo);
 *   origem de ingestão derivada do DSN (`SENTRY_DSN` ou
 *   `NEXT_PUBLIC_SENTRY_DSN`), incluída em `connect-src` somente quando
 *   configurado.
 * - Fontes/imagens: `next/font/google` (Geist) é self-hosted no build
 *   (`/_next/static/media`, sem request runtime a Google Fonts) e `next/image`
 *   não tem `remotePatterns`; por isso `font-src`/`img-src` ficam restritos a
 *   same-origin (+ `data:`/`blob:` para inline/otimização).
 * - Telemetria: `report-uri /api/csp-report` (endpoint same-origin, sem PII,
 *   com rate limit) em ambas as políticas para coleta de violações.
 */

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const CSP_ENFORCING_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ENDPOINT = "/api/csp-report";

function parseHttpOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Origem do projeto Supabase (ex.: `https://xyz.supabase.co`) ou `null`. */
export function getSupabaseCspOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  return parseHttpOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Par `https:`/`wss:` da origem Supabase para `connect-src` (REST + Realtime). */
export function getSupabaseConnectSources(env: NodeJS.ProcessEnv = process.env): string[] {
  const origin = getSupabaseCspOrigin(env);
  if (!origin) return [];
  try {
    const parsed = new URL(origin);
    const secure = parsed.protocol === "https:" ? `wss://${parsed.host}` : `ws://${parsed.host}`;
    return origin === secure ? [origin] : [origin, secure];
  } catch {
    return [];
  }
}

/** Origem de ingestão do Sentry derivada do DSN (ex.: `https://o123.ingest.sentry.io`) ou `null`. */
export function getSentryIngestOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const dsn = env.SENTRY_DSN?.trim() || env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return null;
  try {
    const parsed = new URL(dsn);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function isProductionBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV?.trim() === "production";
}

export interface CspBuildEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SENTRY_DSN?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NODE_ENV?: string;
  CSP_ENFORCE?: string;
}

export interface CspHeader {
  key: string;
  value: string;
}

/** Rollout gradual: efetiva SOMENTE com `CSP_ENFORCE=true` (ou `1`). Padrão: report-only. */
export function shouldEnforceCsp(env: CspBuildEnv = process.env): boolean {
  const raw = env.CSP_ENFORCE?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/** Monta o valor canônico da política (usado em ambos os modos). */
export function buildCspValue(env: CspBuildEnv = process.env): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  // Next.js dev (HMR/React Refresh) exige eval; produção nunca usa.
  if (!isProductionBuild(env as NodeJS.ProcessEnv)) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'"];
  for (const source of getSupabaseConnectSources(env as NodeJS.ProcessEnv)) {
    if (!connectSrc.includes(source)) connectSrc.push(source);
  }
  const sentryOrigin = getSentryIngestOrigin(env as NodeJS.ProcessEnv);
  if (sentryOrigin && !connectSrc.includes(sentryOrigin)) connectSrc.push(sentryOrigin);

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_ENDPOINT}`,
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

/** Monta o valor da política Report-Only a partir do ambiente (alias do valor canônico). */
export function buildCspReportOnlyValue(env: CspBuildEnv = process.env): string {
  return buildCspValue(env);
}

/** Monta o valor da política efetiva (idêntico ao Report-Only após observação). */
export function buildCspEnforcingValue(env: CspBuildEnv = process.env): string {
  return buildCspValue(env);
}

/**
 * Headers CSP a emitir: sempre Report-Only (telemetria contínua) + efetivo
 * somente sob `CSP_ENFORCE=true`. Os headers são avaliados no build
 * (routes-manifest); rollback = remover a flag e fazer redeploy.
 */
export function getCspHeaders(env: CspBuildEnv = process.env): CspHeader[] {
  const headers: CspHeader[] = [{ key: CSP_REPORT_ONLY_HEADER, value: buildCspValue(env) }];
  if (shouldEnforceCsp(env)) {
    headers.push({ key: CSP_ENFORCING_HEADER, value: buildCspValue(env) });
  }
  return headers;
}
