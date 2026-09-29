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
 *   fail-open por instância e nunca como garantia global.
 * - Qualquer falha do store distribuído resulta em ALLOW (fail-open) com log
 *   sanitizado, preservando retries legítimos de webhook e idempotência
 *   financeira (a idempotência real segue na RPC atômica).
 */

export interface RateLimitHit {
  count: number;
  ttlMs: number;
}

export interface RateLimitStore {
  readonly name: string;
  readonly isDistributed: boolean;
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  /** Liberação best-effort (usada quando o retry do provedor deve ser preservado). */
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
    const bucket = this.buckets.get(normalizeKey(key));
    if (!bucket) return;
    bucket.count -= 1;
    if (bucket.count <= 0) this.buckets.delete(normalizeKey(key));
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
      await fetch(`${this.url}/decr`, {
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

export interface BillingCooldownDecision {
  deduped: boolean;
  storeName: string;
  distributed: boolean;
  fallback: boolean;
}

export function billingLimitKey(...parts: Array<string | undefined | null>): string {
  return parts
    .map((p) => (p || "unknown").trim().slice(0, 96) || "unknown")
    .join(":");
}

/**
 * Checagem de limite com fallback seguro: qualquer falha do store distribuído
 * cai para memória local e, em última instância, permite (fail-open) para não
 * quebrar retries legítimos do provedor nem a idempotência financeira.
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

  const tryStores = resolveStoreChain();

  let lastError: unknown = null;
  for (const store of tryStores) {
    try {
      const hit = await store.hit(normKey, window);
      const allowed = hit.count <= safeLimit;
      return {
        allowed,
        count: hit.count,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(hit.ttlMs / 1000)),
        storeName: store.name,
        distributed: store.isDistributed,
        fallback: store !== tryStores[0],
      };
    } catch (error) {
      lastError = error;
      try {
        const msg = error instanceof Error ? error.message : String(error);
        onFallback?.({ storeName: store.name, errorMessage: msg.slice(0, 200) });
      } catch {
        // Nunca quebrar a rota por causa do hook de log.
      }
    }
  }

  void lastError;
  return {
    allowed: true,
    count: 1,
    retryAfterSeconds: 0,
    storeName: "fail-open",
    distributed: false,
    fallback: true,
  };
}

/**
 * Cooldown/dedupe: a primeira ocorrência na janela prossegue; repetições
 * retornam `deduped=true` e a rota deve responder 200 SEM consultar o
 * Mercado Pago (evita 1 consulta externa por requisição em rajadas).
 */
export async function checkBillingCooldownAndMark(
  key: string,
  windowMs: number,
  onFallback?: (info: { storeName: string; errorMessage: string }) => void,
): Promise<BillingCooldownDecision> {
  const decision = await checkBillingLimit(key, 1, windowMs, onFallback);
  return {
    deduped: decision.count > 1,
    storeName: decision.storeName,
    distributed: decision.distributed,
    fallback: decision.fallback,
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
  webhookPayment: { limit: 30, windowMs: 60_000 },
  ipnIp: { limit: 60, windowMs: 60_000 },
  ipnPayment: { limit: 20, windowMs: 60_000 },
  ipnPaymentCooldownMs: 30_000,
  checkoutUser: { limit: 15, windowMs: 60_000 },
  checkoutIp: { limit: 60, windowMs: 60_000 },
  checkoutUserCooldownMs: 10_000,
  syncUser: { limit: 12, windowMs: 60_000 },
  syncUserCooldownMs: 20_000,
  verifyUser: { limit: 60, windowMs: 60_000 },
  verifyPaymentCooldownMs: 10_000,
} as const;
