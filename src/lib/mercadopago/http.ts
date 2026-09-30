import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";

/**
 * MAI-144 — Timeouts, abort e política de retry para chamadas ao Mercado Pago.
 *
 * - Toda chamada externa crítica possui deadline explícito via `AbortSignal.timeout`
 *   (fallback para `AbortController` em runtimes antigos).
 * - Erros são classificados em TRANSITÓRIOS (timeout / abort / queda de rede /
 *   408 / 429 / 5xx) vs DEFINITIVOS (400 / 401 / 403 / 404 / 422).
 * - Política de retry segura: apenas métodos idempotentes (GET) podem ser
 *   repetidos internamente; POST de criação (ex.: `/checkout/preferences`) é
 *   NÃO idempotente e NUNCA recebe retry automático — o retry legítimo é
 *   delegado ao provedor/cliente via status retentável (502/504/429/503).
 * - Timeout NUNCA concede Pro nem toca o ledger: as rotas tratam
 *   `MercadoPagoTimeoutError`/`MercadoPagoNetworkError` como falha retentável
 *   antes de qualquer validação/concessão.
 * - Logs sanitizados: nunca registram Authorization, tokens ou corpo.
 */

export const MERCADO_PAGO_TIMEOUTS = {
  /** Criação de preferência (POST não idempotente — sem retry interno). */
  checkoutCreateMs: 10_000,
  /** Leitura de pagamento por ID (GET idempotente — webhook/verify/IPN). */
  paymentFetchMs: 8_000,
  /** Buscas de conciliação (GET idempotente — sync). */
  syncSearchMs: 10_000,
} as const;

export type MercadoPagoOperation = "checkout.create" | "payments.get" | "payments.search";

function getEnvTimeoutOverride(): number | null {
  const raw = process.env.MERCADO_PAGO_TIMEOUT_MS?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.max(Math.floor(parsed), 1), 60_000);
}

export function getTimeoutForOperation(operation: MercadoPagoOperation): number {
  const override = getEnvTimeoutOverride();
  if (override !== null) return override;
  switch (operation) {
    case "checkout.create":
      return MERCADO_PAGO_TIMEOUTS.checkoutCreateMs;
    case "payments.search":
      return MERCADO_PAGO_TIMEOUTS.syncSearchMs;
    case "payments.get":
    default:
      return MERCADO_PAGO_TIMEOUTS.paymentFetchMs;
  }
}

export class MercadoPagoTimeoutError extends Error {
  readonly operation: MercadoPagoOperation;
  readonly timeoutMs: number;
  constructor(operation: MercadoPagoOperation, timeoutMs: number) {
    super(`Tempo esgotado na chamada ao Mercado Pago (${operation}, ${timeoutMs}ms)`);
    this.name = "MercadoPagoTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class MercadoPagoNetworkError extends Error {
  readonly operation: MercadoPagoOperation;
  constructor(operation: MercadoPagoOperation, message = "Falha de rede na chamada ao Mercado Pago") {
    super(message);
    this.name = "MercadoPagoNetworkError";
    this.operation = operation;
  }
}

/** Status transitórios: permitem retentativa legítima (provedor/cliente). */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Status definitivos: nunca devem gerar retry (responder 200 ignored / 4xx final). */
const DEFINITIVE_STATUSES = new Set([400, 401, 403, 404, 422]);

export function isTransientMercadoPagoStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

export function isDefinitiveMercadoPagoStatus(status: number): boolean {
  return DEFINITIVE_STATUSES.has(status);
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof MercadoPagoTimeoutError) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.name === "TimeoutError" || record.name === "AbortError") return true;
  if (typeof record.message === "string" && /timeout|aborted|abort/i.test(record.message)) return true;
  const cause = record.cause;
  if (cause && typeof cause === "object") {
    const causeRecord = cause as Record<string, unknown>;
    if (causeRecord.name === "TimeoutError" || causeRecord.name === "AbortError") return true;
    if (typeof causeRecord.message === "string" && /timeout|aborted|abort/i.test(causeRecord.message)) return true;
  }
  return false;
}

export function isTransientMercadoPagoFailure(error: unknown): boolean {
  if (
    error instanceof MercadoPagoTimeoutError ||
    error instanceof MercadoPagoNetworkError ||
    error instanceof SupabaseRpcTimeoutError
  ) {
    return true;
  }
  if (isTimeoutError(error)) return true;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number" && isTransientMercadoPagoStatus(record.status)) return true;
    if (typeof record.upstream_status === "number" && isTransientMercadoPagoStatus(record.upstream_status)) return true;
  }
  // Quedas de rede do fetch (TypeError / ECONNRESET / ENOTFOUND / socket hang up).
  if (error instanceof TypeError) return true;
  if (error instanceof Error && /fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|network/i.test(error.message)) {
    return true;
  }
  return false;
}

/**
 * Política de retry segura (MAI-144):
 * - GET idempotente (`payments.get`, `payments.search`) => retry interno permitido
 *   (limitado, com backoff) OU retry delegado ao provedor via 502/504/429.
 * - POST não idempotente (`checkout.create`) => NUNCA repetir automaticamente
 *   sem chave de idempotência; retorna falha retentável para o cliente tentar de novo.
 */
export function isSafeToRetry(operation: MercadoPagoOperation, method: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  return operation === "payments.get" || operation === "payments.search";
}

function buildTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  // Caminho preferencial: AbortSignal.timeout (Node 18+ / runtimes modernos).
  if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as unknown as { timeout?: unknown }).timeout === "function") {
    return {
      signal: (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(timeoutMs),
      cleanup: () => undefined,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Mercado Pago timeout after ${timeoutMs}ms`)), timeoutMs);
  if (typeof timer === "object" && typeof (timer as unknown as { unref?: unknown }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export interface FetchMercadoPagoOptions extends Omit<RequestInit, "signal"> {
  operation: MercadoPagoOperation;
  timeoutMs?: number;
  /** Sinal externo opcional (ex.: cancelamento do cliente) — combinado com o timeout. */
  outerSignal?: AbortSignal | null;
}

/**
 * Fetch centralizado para o Mercado Pago com deadline explícito.
 * Injeta `Authorization: Bearer <token>` internamente para que call sites nunca
 * manipulem o segredo em logs. Nunca registra headers/corpo.
 */
export async function fetchMercadoPago(path: string, options: FetchMercadoPagoOptions): Promise<Response> {
  const { operation, timeoutMs, outerSignal, ...init } = options;
  const deadline = timeoutMs ?? getTimeoutForOperation(operation);
  const { signal: timeoutSignal, cleanup } = buildTimeoutSignal(deadline);

  let signal: AbortSignal | undefined = timeoutSignal;
  if (outerSignal) {
    if (outerSignal.aborted) {
      cleanup();
      throw new MercadoPagoTimeoutError(operation, deadline);
    }
    // Combina timeout + cancelamento externo sem vazar listeners.
    const controller = new AbortController();
    const onAbort = () => controller.abort(
      outerSignal.aborted
        ? (outerSignal.reason ?? new Error("Operacao cancelada"))
        : (timeoutSignal.reason ?? new Error(`Mercado Pago timeout after ${deadline}ms`)),
    );
    timeoutSignal.addEventListener("abort", onAbort, { once: true });
    outerSignal.addEventListener("abort", onAbort, { once: true });
    signal = controller.signal;
    try {
      const response = await fetch(`${getMercadoPagoApiUrl()}${path}`, {
        ...init,
        signal,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${getMercadoPagoAccessToken()}`,
        },
      });
      return response;
    } catch (error) {
      if (isTimeoutError(error) || (signal.aborted && timeoutSignal.aborted)) {
        throw new MercadoPagoTimeoutError(operation, deadline);
      }
      throw new MercadoPagoNetworkError(operation, error instanceof Error ? error.message : undefined);
    } finally {
      timeoutSignal.removeEventListener("abort", onAbort);
      outerSignal.removeEventListener("abort", onAbort);
      cleanup();
    }
  }

  try {
    const response = await fetch(`${getMercadoPagoApiUrl()}${path}`, {
      ...init,
      signal,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${getMercadoPagoAccessToken()}`,
      },
    });
    return response;
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new MercadoPagoTimeoutError(operation, deadline);
    }
    throw new MercadoPagoNetworkError(operation, error instanceof Error ? error.message : undefined);
  } finally {
    cleanup();
  }
}

/** Metadados sanitizados para logs estruturados (sem tokens/segredos). */
export function sanitizedMercadoPagoLogContext(params: {
  operation: MercadoPagoOperation;
  timeoutMs?: number;
  paymentId?: string | number;
  userId?: string;
  upstreamStatus?: number;
  failureKind?: "mercadopago_timeout" | "mercadopago_network" | "mercadopago_upstream";
}): Record<string, unknown> {
  return {
    mp_operation: params.operation,
    mp_timeout_ms: params.timeoutMs ?? getTimeoutForOperation(params.operation),
    ...(params.paymentId !== undefined ? { mp_payment_ref: String(params.paymentId).slice(0, 64) } : {}),
    ...(params.upstreamStatus !== undefined ? { upstream_status: params.upstreamStatus } : {}),
    ...(params.failureKind ? { failure_kind: params.failureKind } : {}),
  };
}

// ─── Deadlines para RPCs do Supabase (MAI-144 ciclo 5) ───────────────────────
// Nenhuma chamada externa crítica ao banco/RPC fica sem deadline explícito.
// O timeout NÃO cancela o trabalho já em voo no Postgres; a segurança vem da
// idempotência da própria RPC (claim único por payment_id / bucket): o retry
// re-invoca com os mesmos parâmetros e recebe `already_processed`.

export const SUPABASE_RPC_TIMEOUTS = {
  /** RPC financeira crítica do ledger (concessão de vigência / reversão). */
  financialRpcMs: 15_000,
  /** RPCs do rate limiter (não financeiras; falha vira fail-closed a montante). */
  rateLimitRpcMs: 5_000,
} as const;

export type SupabaseRpcKind = "financial" | "rateLimit";

function getSupabaseRpcEnvOverride(): number | null {
  const raw = process.env.SUPABASE_RPC_TIMEOUT_MS?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.max(Math.floor(parsed), 1), 60_000);
}

export function getSupabaseRpcTimeout(kind: SupabaseRpcKind): number {
  const override = getSupabaseRpcEnvOverride();
  if (override !== null) return override;
  return kind === "financial" ? SUPABASE_RPC_TIMEOUTS.financialRpcMs : SUPABASE_RPC_TIMEOUTS.rateLimitRpcMs;
}

export class SupabaseRpcTimeoutError extends Error {
  readonly rpcName: string;
  readonly timeoutMs: number;
  constructor(rpcName: string, timeoutMs: number) {
    super(`Supabase RPC ${rpcName} excedeu o deadline (${timeoutMs}ms)`);
    this.name = "SupabaseRpcTimeoutError";
    this.rpcName = rpcName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Envolve uma chamada RPC do Supabase com deadline explícito.
 * Estoura `SupabaseRpcTimeoutError` (transitório, retentável) se o banco não
 * responder dentro do teto. O timer é sempre limpo no settlement.
 * Aceita o thenable do client Supabase (`PostgrestFilterBuilder`), que não é
 * um `Promise` estrito — `Promise.resolve` normaliza antes da corrida.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withSupabaseRpcTimeout(task: PromiseLike<any>, rpcName: string, timeoutMs?: number): Promise<any> {
  const deadline = timeoutMs ?? getSupabaseRpcTimeout("financial");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SupabaseRpcTimeoutError(rpcName, deadline));
    }, deadline);
    // MAI-144: NUNCA aplicar .unref() aqui — o timer deve manter o event
    // loop ativo até disparar ou ser limpo no finally (Node 22 encerra o
    // loop prematuramente se o timer for desvinculado e a RPC pendurar).
  });
  return Promise.race([Promise.resolve(task), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
