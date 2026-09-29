/**
 * Content-Security-Policy em modo Report-Only (MAI-133).
 *
 * Fonte única da política CSP. `next.config.ts` consome `buildCspReportOnlyValue()`
 * para emitir o header `Content-Security-Policy-Report-Only`; nenhuma outra
 * camada emite headers CSP.
 *
 * Mapa de origens reais (justificativa por diretiva):
 * - Next.js / App Router + assets same-origin: `self` em todas as diretivas de
 *   busca; `script-src` + `unsafe-inline` (script anti-FOUC de tema em
 *   `src/app/layout.tsx` + runtime inline do Next.js); `style-src` +
 *   `unsafe-inline` (estilos inline injetados pelo Next.js/Tailwind).
 *   `unsafe-eval` NUNCA em produção — liberado apenas fora de produção para o
 *   HMR/overlay do `next dev`.
 * - Supabase: origem derivada de `NEXT_PUBLIC_SUPABASE_URL` (REST/Auth/Storage)
 *   + equivalente `wss:` (Realtime). Incluída em `connect-src` somente quando a
 *   variável está configurada e válida.
 * - Mercado Pago: o browser nunca chama a API diretamente (proxy same-origin
 *   `/api/mercadopago/*`). O checkout usa navegacao top-level via
 *   `window.location.href = payload.init_point`
 *   (`src/components/subscription/subscription-card.tsx`), nao submissao de
 *   formulario - portanto nenhuma origem Mercado Pago e exigida em `form-action`,
 *   que permanece `'self'`; nenhum `iframe` de terceiros e usado, por isso
 *   `frame-src` permanece `self`.
 * - Sentry: origem de ingestão derivada do DSN (`SENTRY_DSN` ou
 *   `NEXT_PUBLIC_SENTRY_DSN`), incluída em `connect-src` somente quando
 *   configurado.
 * - Fontes/imagens: `next/font` (Geist) é self-hosted e `next/image` não tem
 *   `remotePatterns`; por isso `font-src`/`img-src` ficam restritos a
 *   same-origin (+ `data:`/`blob:` para inline/otimização).
 */

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

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
}

/** Monta o valor da política Report-Only a partir do ambiente. */
export function buildCspReportOnlyValue(env: CspBuildEnv = process.env): string {
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
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}
