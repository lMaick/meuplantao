import { createHash } from "node:crypto";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

/**
 * MAI-138 — Rate limit / cooldown distribuído para billing (IPN, checkout, sync, verify).
 *
 * Arquitetura (Vercel/serverless):
 * - O store canônico distribuído é o Upstash Redis via REST quando
 *   `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` estão configurados.
 * - Sem Upstash, usa Supabase (`billing_rate_limits` + RPC `billing_rate_limit_hit`)
 *   via service_role — também distribuído (linha compartilhada no banco).
 * - A memória local (`MemoryRateLimitStore`) existe SOMENTE como fallback
 *   por instância em ambientes não-produção (testes/dev) e nunca como
 *   garantia global.
 * - MAI-138 (auditoria externa) — fail-closed sob colapso: quando NENHUM store
 *   distribuído está operacional (todos falharam, ou nenhum configurado em
 *   produção), as decisões retornam `collapsed: true` e as rotas DEVEM
 *   responder falha temporária segura (`503` + `Retry-After`) SEM consultar o
 *   Mercado Pago. Degradar para fail-open/memória local permitiria que
 *   instâncias paralelas consumissem a quota do provedor em rajada.
 * - A idempotência financeira real segue na RPC atômica
 *   (`process_mercadopago_subscription_payment`).
 */

export interface RateLimitHit {
  count: number;
  ttlMs: number;
}

export interface RateLimitStore {
  readonly name: string;
  readonly isDistributed: boolean;
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  /**
   * Liberação best-effort com semântica de unlock: remove a chave por
   * completo (não apenas decrementa), de modo que o dono do lock in-flight
   * sempre libere — mesmo que contenção concorrente tenha incrementado o
   * contador. Usada quando o retry do provedor deve ser preservado.
   */
  release?(key: string): Promise<void>;
  resetForTesting?(): void;
}

export interface BillingLimitDecision {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
  storeName: string;
  distributed: boolean;
  fallback: boolean;
  /**
   * MAI-138 (auditoria externa): `true` quando nenhum store distribuído está
   * operacional (todos falharam, ou nenhum configurado em produção).
   * A rota DEVE responder `503` + `Retry-After` SEM consultar o Mercado Pago.
   */
  collapsed: boolean;
}

const WINDOW_FLOOR_MS = 1000;
const MAX_KEY_LENGTH = 256;

function normalizeWindow(windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs < WINDOW_FLOOR_MS) return WINDOW_FLOOR_MS;
  return Math.floor(windowMs);
}

function normalizeKey(key: string): string {
  const trimmed = (key || "").trim().slice(0, MAX_KEY_LENGTH);
  return trimmed || "billing:unknown";
}

// ---------------------------------------------------------------------------
// Memory store (fallback por instância — NÃO é garantia global)
// ---------------------------------------------------------------------------

interface MemoryBucket {
  count: number;
  expiresAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly name = "memory-fallback";
  readonly isDistributed = false;
  private buckets = new Map<string, MemoryBucket>();

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const window = normalizeWindow(windowMs);
    const now = Date.now();
    const normKey = normalizeKey(key);
    const bucket = this.buckets.get(normKey);
    if (!bucket || bucket.expiresAt <= now) {
      const expiresAt = now + window;
      this.buckets.set(normKey, { count: 1, expiresAt });
      return { count: 1, ttlMs: window };
    }
    bucket.count += 1;
    return { count: bucket.count, ttlMs: Math.max(0, bucket.expiresAt - now) };
  }

  resetForTesting(): void {
    this.buckets.clear();
  }

  async release(key: string): Promise<void> {
    // Unlock total: contenção concorrente pode ter elevado o contador;
    // decrementar deixaria o lock "meio preso" até o TTL.
    this.buckets.delete(normalizeKey(key));
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis via REST (distribuído, sem dependência extra)
// ---------------------------------------------------------------------------

/**
 * Script Lua atômico: INCR + garantia de TTL na MESMA execução.
 * Sem ele, um INCR sem PEXPIRE deixaria a chave sem expiração para sempre.
 * Auto-repara chaves legadas sem TTL (PTTL < 0).
 */
const RATE_LIMIT_LUA = [
  "local current = redis.call('INCR', KEYS[1])",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "if current == 1 or ttl < 0 then",
  "  redis.call('PEXPIRE', KEYS[1], ARGV[1])",
  "  ttl = tonumber(ARGV[1])",
  "end",
  "return {current, ttl}",
].join("\n");

export class UpstashRateLimitStore implements RateLimitStore {
  readonly name = "upstash-redis";
  readonly isDistributed = true;
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const window = normalizeWindow(windowMs);
    const normKey = normalizeKey(key);
    // UMA única chamada REST: incremento e expiração aplicados atomicamente
    // no servidor (sem janela entre INCR e PEXPIRE).
    const evalRes = await fetch(`${this.url}/eval`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([RATE_LIMIT_LUA, 1, normKey, String(window)]),
    });
    if (!evalRes.ok) throw new Error(`Upstash eval failed: ${evalRes.status}`);
    const payload = (await evalRes.json()) as { result?: unknown };
    const tuple = payload?.result as Array<unknown> | undefined;
    const count = Number(tuple?.[0]);
    const ttlMs = Number(tuple?.[1]);
    if (!Number.isFinite(count) || count < 1) throw new Error("Upstash EVAL sem contagem valida");
    return { count, ttlMs: Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : window };
  }

  async release(key: string): Promise<void> {
    try {
      // Unlock total (DEL): o dono sempre libera o in-flight, mesmo sob
      // contenção que elevou o contador via INCR.
      await fetch(`${this.url}/del`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([normalizeKey(key)]),
      });
    } catch {
      // Best-effort: falha na liberação nunca quebra a rota.
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase store (distribuído via tabela compartilhada + RPC atômica)
// ---------------------------------------------------------------------------

export type SupabaseRpcAdmin = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export class SupabaseRateLimitStore implements RateLimitStore {
  readonly name = "supabase";
  readonly isDistributed = true;
  private readonly getAdmin: () => SupabaseRpcAdmin;

  constructor(getAdmin: () => SupabaseRpcAdmin) {
    this.getAdmin = getAdmin;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const window = normalizeWindow(windowMs);
    const normKey = normalizeKey(key);
    const admin = this.getAdmin();
    const { data, error } = await admin.rpc("billing_rate_limit_hit", {
      p_bucket_key: normKey,
      p_window_seconds: Math.max(1, Math.ceil(window / 1000)),
    });
    if (error) throw new Error(`Supabase rate limit RPC falhou: ${error.message || error.code || "unknown"}`);
    const row = (Array.isArray(data) ? data[0] : data) as {
      count?: unknown;
      hit_count?: unknown;
      ttl_ms?: unknown;
    } | null;
    const count = Number(row?.count ?? row?.hit_count ?? NaN);
    const ttlMs = Number(row?.ttl_ms ?? window);
    if (!Number.isFinite(count) || count < 1) throw new Error("Supabase rate limit sem contagem valida");
    return { count, ttlMs: Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : window };
  }

  async release(key: string): Promise<void> {
    try {
      await this.getAdmin().rpc("billing_rate_limit_release", {
        p_bucket_key: normalizeKey(key),
      });
    } catch {
      // Best-effort (ex.: RPC ainda não migrada): nunca quebra a rota.
    }
  }
}

// ---------------------------------------------------------------------------
// Resolução do store + overrides de teste
// ---------------------------------------------------------------------------

let testStoreOverride: RateLimitStore | null = null;
let sharedMemoryFallback: MemoryRateLimitStore | null = null;
let cachedSupabaseStore: SupabaseRateLimitStore | null = null;
let cachedSupabaseStoreKey = "";

function getMemoryFallback(): MemoryRateLimitStore {
  if (!sharedMemoryFallback) sharedMemoryFallback = new MemoryRateLimitStore();
  return sharedMemoryFallback;
}

export function setRateLimitStoreForTesting(store: RateLimitStore | null): void {
  testStoreOverride = store;
}

export function clearRateLimitStoreForTesting(): void {
  testStoreOverride = null;
}

export function resetBillingRateLimitsForTesting(): void {
  testStoreOverride?.resetForTesting?.();
  sharedMemoryFallback?.resetForTesting();
}

function isProdRuntime(): boolean {
  return process.env.VERCEL_ENV?.trim() === "production" || process.env.NODE_ENV?.trim() === "production";
}

/**
 * MAI-138 — Habilitação do limitador.
 * Produção: SEMPRE ligado (protege quota do Mercado Pago por padrão).
 * Demais ambientes: ligado apenas com `BILLING_RATE_LIMIT_ENABLED=true`
 * (cobertura de testes sem interferir na suíte legada).
 * `BILLING_RATE_LIMIT_DISABLED=true` desliga em qualquer ambiente
 * (kill-switch de emergência; nunca versionar como padrão).
 */
export function isBillingRateLimitEnabled(): boolean {
  const disabled = process.env.BILLING_RATE_LIMIT_DISABLED?.trim().toLowerCase();
  if (disabled === "true" || disabled === "1" || disabled === "yes") return false;
  const explicit = process.env.BILLING_RATE_LIMIT_ENABLED?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1" || explicit === "yes") return true;
  if (explicit === "false" || explicit === "0" || explicit === "no") return false;
  return isProdRuntime();
}

function getUpstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) return { url, token };
  return null;
}

function getCachedSupabaseStore(): SupabaseRateLimitStore | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceKey) return null;
  const cacheKey = `${url.length}:${serviceKey.length}`;
  if (!cachedSupabaseStore || cachedSupabaseStoreKey !== cacheKey) {
    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as SupabaseRpcAdmin;
    cachedSupabaseStore = new SupabaseRateLimitStore(() => admin);
    cachedSupabaseStoreKey = cacheKey;
  }
  return cachedSupabaseStore;
}

export function resolveSupabaseStoreIfConfigured(): RateLimitStore | null {
  if (testStoreOverride) return testStoreOverride;
  return getCachedSupabaseStore();
}

function resolveStoreChain(): RateLimitStore[] {
  if (testStoreOverride) return [testStoreOverride];
  const chain: RateLimitStore[] = [];
  const upstash = getUpstashConfig();
  // Ordem: Upstash (mais rápido) > Supabase (compartilhado) > memória (fallback local).
  if (upstash) chain.push(new UpstashRateLimitStore(upstash.url, upstash.token));
  const supabaseStore = getCachedSupabaseStore();
  if (supabaseStore) chain.push(supabaseStore);
  chain.push(getMemoryFallback());
  return chain;
}

// ---------------------------------------------------------------------------
// Helpers públicos
// ---------------------------------------------------------------------------

export const MAX_BILLING_BODY_BYTES = 32 * 1024;

const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidBillingPaymentId(value: string | undefined | null): boolean {
  if (!value || typeof value !== "string") return false;
  return PAYMENT_ID_PATTERN.test(value.trim());
}

export function getBillingBodySizeOk(rawBody: string | undefined | null): boolean {
  if (!rawBody) return true;
  return Buffer.byteLength(rawBody, "utf8") <= MAX_BILLING_BODY_BYTES;
}

export function getClientIp(request: Request): string {
  try {
    const headers = (request as Partial<Request> & { headers?: Headers }).headers;
    const forwarded = headers?.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first.slice(0, 64);
    }
    const realIp = headers?.get("x-real-ip")?.trim();
    if (realIp) return realIp.slice(0, 64);
  } catch {
    // Requisição sem headers legíveis: trata como origem desconhecida.
  }
  return "unknown";
}

export function hashIpForLog(ip: string): string {
  return createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 12);
}

export function buildBillingRateLimitedResponse(retryAfterSeconds: number): Response {
  const retry = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(300, Math.ceil(retryAfterSeconds))
    : 60;
  return Response.json(
    { error: "Muitas requisicoes. Tente novamente em instantes." },
    { status: 429, headers: { "Retry-After": String(retry) } },
  );
}

/**
 * MAI-138 (auditoria externa, bloqueador 1): resposta fail-closed quando os
 * stores distribuídos colapsaram. Corpo genérico (sem segredos) + 503 com
 * `Retry-After`, preservando os retries automáticos do Mercado Pago
 * (webhook/IPN) sem disparar nenhuma consulta externa.
 */
export function buildBillingStoresCollapsedResponse(retryAfterSeconds: number = BILLING_LIMITS.storesCollapsedRetryAfterSeconds): Response {
  const retry = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.min(300, Math.ceil(retryAfterSeconds))
    : 30;
  return Response.json(
    { error: "Servico temporariamente indisponivel. Tente novamente em instantes." },
    { status: 503, headers: { "Retry-After": String(retry) } },
  );
}

export interface BillingCooldownDecision {
  deduped: boolean;
  storeName: string;
  distributed: boolean;
  fallback: boolean;
  /**
   * MAI-138 (auditoria externa): ver `BillingLimitDecision.collapsed`.
   * Deve ser verificado ANTES de `deduped`.
   */
  collapsed: boolean;
}

export function billingLimitKey(...parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (p || "unknown").trim().slice(0, 96) || "unknown")
    .join(":");
}

/**
 * Checagem de limite com fallback seguro (MAI-138, auditoria externa).
 *
 * - Tenta os stores DISTRIBUÍDOS em ordem (Upstash > Supabase). O primeiro
 *   sucesso decide (fail-closed por instância nunca mascara o estado global).
 * - Se TODOS os distribuídos falharem — ou se nenhum estiver configurado em
 *   produção — retorna `collapsed: true` com `allowed: false`: a rota DEVE
 *   responder `503` + `Retry-After` SEM consultar o Mercado Pago. Cair para
 *   memória local/fail-open permitiria que instâncias serverless paralelas
 *   consumissem a quota do provedor em rajada.
 * - Sem nenhum distribuído configurado fora de produção (testes/dev com
 *   `MemoryRateLimitStore`), a memória local decide normalmente com
 *   `collapsed: false` (paridade com a suíte de testes).
 */
export async function checkBillingLimit(
  key: string,
  limit: number,
  windowMs: number,
  onFallback?: (info: { storeName: string; errorMessage: string }) => void,
): Promise<BillingLimitDecision> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const window = normalizeWindow(windowMs);
  const normKey = normalizeKey(key);

  const reportFallback = (storeName: string, error: unknown) => {
    try {
      const msg = error instanceof Error ? error.message : String(error);
      onFallback?.({ storeName, errorMessage: msg.slice(0, 200) });
    } catch {
      // Nunca quebrar a rota por causa do hook de log.
    }
  };

  const chain = resolveStoreChain();
  const distributed = chain.filter((store) => store.isDistributed);

  // Nenhum store distribuído na cadeia.
  if (distributed.length === 0) {
    if (isProdRuntime()) {
      // Produção sem store distribuído = sem proteção global: fail-closed.
      reportFallback("no-distributed-store", new Error("Nenhum store distribuido configurado em producao"));
      return {
        allowed: false,
        count: 0,
        retryAfterSeconds: BILLING_LIMITS.storesCollapsedRetryAfterSeconds,
        storeName: "no-distributed-store",
        distributed: false,
        fallback: true,
        collapsed: true,
      };
    }
    // Fora de produção (testes/dev): memória local decide normalmente.
    const local = chain[0];
    if (!local) {
      return {
        allowed: true,
        count: 1,
        retryAfterSeconds: 0,
        storeName: "fail-open",
        distributed: false,
        fallback: true,
        collapsed: false,
      };
    }
    try {
      const hit = await local.hit(normKey, window);
      const allowed = hit.count <= safeLimit;
      return {
        allowed,
        count: hit.count,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(hit.ttlMs / 1000)),
        storeName: local.name,
        distributed: false,
        fallback: false,
        collapsed: false,
      };
    } catch (error) {
      reportFallback(local.name, error);
      return {
        allowed: true,
        count: 1,
        retryAfterSeconds: 0,
        storeName: "fail-open",
        distributed: false,
        fallback: true,
        collapsed: false,
      };
    }
  }

  // Há stores distribuídos: o primeiro sucesso decide. Falhas são reportadas
  // via onFallback (log sanitizado/observável) e NÃO degradam para memória
  // local — degradação per-instância furaria o teto global.
  for (const store of distributed) {
    try {
      const hit = await store.hit(normKey, window);
      const allowed = hit.count <= safeLimit;
      return {
        allowed,
        count: hit.count,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(hit.ttlMs / 1000)),
        storeName: store.name,
        distributed: true,
        fallback: store !== distributed[0],
        collapsed: false,
      };
    } catch (error) {
      reportFallback(store.name, error);
    }
  }

  // Colapso: todos os distribuídos falharam. Fail-closed (nunca fail-open).
  return {
    allowed: false,
    count: 0,
    retryAfterSeconds: BILLING_LIMITS.storesCollapsedRetryAfterSeconds,
    storeName: "stores-collapsed",
    distributed: false,
    fallback: true,
    collapsed: true,
  };
}

/**
 * Cooldown/dedupe: a primeira ocorrência na janela prossegue; repetições
 * retornam `deduped=true` e a rota deve responder 200 SEM consultar o
 * Mercado Pago (evita 1 consulta externa por requisição em rajadas).
 *
 * Também é a primitiva do lock in-flight por payment ID (bloqueador 2):
 * `deduped=false` significa que esta requisição adquiriu o lock; as demais
 * recebem resposta retentável sem novo fetch. `collapsed` deve ser verificado
 * antes de `deduped` (fail-closed sob colapso dos stores).
 */
export async function checkBillingCooldownAndMark(
  key: string,
  windowMs: number,
  onFallback?: (info: { storeName: string; errorMessage: string }) => void,
): Promise<BillingCooldownDecision> {
  const decision = await checkBillingLimit(key, 1, windowMs, onFallback);
  return {
    deduped: !decision.collapsed && decision.count > 1,
    storeName: decision.storeName,
    distributed: decision.distributed,
    fallback: decision.fallback,
    collapsed: decision.collapsed,
  };
}

/**
 * Libera um slot de cooldown marcado anteriormente (best-effort, no mesmo
 * store que registrou o hit). Usado quando a rota falha de forma retentável
 * (502/500/429 upstream): o retry legítimo do provedor deve voltar a
 * consultar a API em vez de receber `deduped:true`.
 */
export async function releaseBillingCooldown(key: string, storeName?: string): Promise<void> {
  const normKey = normalizeKey(key);
  const chain = resolveStoreChain();
  const targets = storeName ? chain.filter((s) => s.name === storeName) : chain.slice(0, 1);
  for (const store of targets) {
    try {
      await store.release?.(normKey);
    } catch {
      // Best-effort: nunca quebra a rota.
    }
  }
}

export const BILLING_LIMITS = {
  webhookIp: { limit: 120, windowMs: 60_000 },
  webhookPaymentCooldownMs: 15_000,
  /** Lock in-flight por payment ID no webhook (bloqueador 2): só o dono consulta o MP. */
  webhookInflightMs: 30_000,
  webhookPayment: { limit: 30, windowMs: 60_000 },
  ipnIp: { limit: 60, windowMs: 60_000 },
  ipnPayment: { limit: 20, windowMs: 60_000 },
  ipnPaymentCooldownMs: 30_000,
  /** Lock in-flight por payment ID no IPN (bloqueador 2): só o dono consulta o MP. */
  ipnInflightMs: 30_000,
  /** Resposta retentável para contenção in-flight (duplicata concorrente). */
  inflightRetryAfterSeconds: 5,
  /** Resposta fail-closed sob colapso dos stores distribuídos (bloqueador 1). */
  storesCollapsedRetryAfterSeconds: 30,
  checkoutUser: { limit: 15, windowMs: 60_000 },
  checkoutIp: { limit: 60, windowMs: 60_000 },
  checkoutUserCooldownMs: 10_000,
  syncUser: { limit: 12, windowMs: 60_000 },
  syncUserCooldownMs: 20_000,
  verifyUser: { limit: 60, windowMs: 60_000 },
  verifyPaymentCooldownMs: 10_000,
} as const;
