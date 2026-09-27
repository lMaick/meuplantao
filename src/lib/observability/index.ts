import * as Sentry from "@sentry/nextjs";

// ============================================================================
// 1. Tipos e Contratos
// ============================================================================

export type AlertRule =
  | "webhook_repeated_failure"
  | "checkout_5xx"
  | "sync_5xx"
  | "financial_rpc_error"
  | "critical_error";

export type SeverityLevel = "fatal" | "error" | "warning" | "info";

export interface ErrorContext {
  route?: string;
  rpcName?: string;
  paymentId?: string | number;
  userId?: string;
  httpStatus?: number;
  alertRule?: AlertRule;
  level?: SeverityLevel;
  extra?: Record<string, unknown>;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: SeverityLevel;
  message: string;
  error_type: string;
  route?: string;
  environment: string;
  release: string;
  http_status?: number;
  rpc_name?: string;
  payment_id?: string;
  alert_rule?: AlertRule;
  context?: Record<string, unknown>;
}

// ============================================================================
// 2. Sanitização Rigorosa de Segurança (Zero Vazamento de Segredos e PII)
// ============================================================================

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /auth/i,
  /secret/i,
  /password/i,
  /senha/i,
  /cookie/i,
  /session/i,
  /card/i,
  /cvv/i,
  /service_role/i,
  /anon_key/i,
  /private/i,
  /credential/i,
  /payload/i,
  /raw_body/i,
  /body/i,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Sanitiza valores de texto livre (mensagens de erro, urls, stacks, breadcrumbs)
 * para evitar vazamento acidental de tokens Bearer, chaves service_role, senhas em
 * URLs de banco de dados e JWTs.
 */
export function sanitizeStringValue(value: string): string {
  if (!value || typeof value !== "string") {
    return value;
  }

  let sanitized = value;

  // 1. Connection Strings (PostgreSQL, MySQL, Redis, MongoDB, etc.)
  // Ex: postgresql://postgres.user:minha_senha_secreta@host:5432/db -> postgresql://postgres.user:[REDACTED_PASSWORD]@host:5432/db
  sanitized = sanitized.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s\r\n"']+):([^@\s\r\n"']+)@/g,
    "$1$2:[REDACTED_PASSWORD]@"
  );

  // 2. Authorization / Bearer tokens (soltos ou com cabeçalho)
  // Ex: "Authorization: Bearer SECRET123" ou "Bearer SECRET123" -> "Authorization: Bearer [REDACTED]"
  sanitized = sanitized.replace(
    /\b(authorization\s*[:=]\s*)?(bearer\s+)[^\s,;\r\n"']+/gi,
    "$1Bearer [REDACTED]"
  );
  sanitized = sanitized.replace(
    /\b(authorization\s*[:=]\s*)(?!bearer\b)[^\s,;\r\n"']+/gi,
    "$1[REDACTED]"
  );

  // 3. Pares de chave-valor com segredos conhecidos (service_role, anon_key, secret, password, senha, etc.)
  // Ex: "service_role=SECRET_KEY", "password: my_password"
  sanitized = sanitized.replace(
    /\b(service_role(?:_key)?|anon_key|access_token|refresh_token|api_key|secret_key|webhook_secret|client_secret|password|senha|credential|private_key)([:=]\s*)[^\s,;\r\n"']+/gi,
    "$1$2[REDACTED]"
  );

  // 4. JWTs (completos ou embutidos)
  sanitized = sanitized.replace(
    /\bey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    "[REDACTED_JWT]"
  );

  // 5. Tokens com prefixos Supabase ou Mercado Pago conhecidos
  sanitized = sanitized.replace(
    /\b(sbp_[a-zA-Z0-9_-]{10,}|APP_USR-[a-zA-Z0-9_-]{10,})\b/g,
    "[REDACTED_TOKEN]"
  );

  return sanitized;
}

export function sanitizeObject<T>(input: T, depth = 0): T {
  if (depth > 5 || input === null || input === undefined) {
    return input;
  }

  if (typeof input === "string") {
    return sanitizeStringValue(input) as unknown as T;
  }

  if (typeof input !== "object") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeObject(item, depth + 1)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (val !== null && typeof val === "object") {
      sanitized[key] = sanitizeObject(val, depth + 1);
    } else if (typeof val === "string") {
      sanitized[key] = sanitizeStringValue(val);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized as T;
}

export function sanitizePaymentId(paymentId?: string | number): string | undefined {
  if (paymentId === null || paymentId === undefined) return undefined;
  const str = String(paymentId).trim();
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(str)) {
    return str;
  }
  return "[SANITIZED_ID]";
}

/**
 * Cria uma nova instância de Error higienizada a partir do erro original,
 * assegurando que mensagens, stacks e causas não carreguem segredos antes de
 * serem despachadas ao Sentry ou log estruturado.
 */
export function createSanitizedException(error: unknown, fallbackMessage?: string): Error {
  const rawMessage = error instanceof Error ? error.message : (fallbackMessage || String(error));
  const sanitizedMessage = sanitizeStringValue(rawMessage);
  const sanitizedError = new Error(sanitizedMessage);

  if (error instanceof Error) {
    sanitizedError.name = error.name;
    if (error.stack) {
      sanitizedError.stack = sanitizeStringValue(error.stack);
    }
    if (error.cause) {
      sanitizedError.cause = createSanitizedException(error.cause);
    }
  }

  return sanitizedError;
}

// ============================================================================
// 3. Rastreamento e Detecção de Anomalias (Alertas Agregados)
// ============================================================================

/**
 * NOTA DE ARQUITETURA (Serverless / Vercel):
 * O WebhookFailureTracker mantém contagem em memória POR INSTÂNCIA (isolada/local).
 * Em arquitetura serverless (Vercel Lambdas), o estado de memória não é compartilhado
 * globalmente entre execuções concorrentes ou lambdas distintas.
 *
 * Portanto, a agregação global e os alertas de volume confiáveis
 * (ex.: "3 ou mais falhas em 5 minutos") devem ser configurados no Sentry através de
 * Issue Alerts ou Metric Alerts filtrados pela tag `route: /api/webhooks/mercadopago`.
 *
 * Este tracker local serve como detector complementar para rajadas de erro
 * concentradas na mesma instância de execução.
 */
export class WebhookFailureTracker {
  private failureTimestamps: number[] = [];
  private readonly windowMs: number;
  private readonly threshold: number;

  constructor(threshold = 3, windowMs = 5 * 60 * 1000) {
    this.threshold = threshold;
    this.windowMs = windowMs;
  }

  recordFailure(now = Date.now()): { count: number; isRepeated: boolean } {
    this.cleanup(now);
    this.failureTimestamps.push(now);
    const count = this.failureTimestamps.length;
    return {
      count,
      isRepeated: count >= this.threshold,
    };
  }

  reset(): void {
    this.failureTimestamps = [];
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((ts) => ts > cutoff);
  }
}

export const webhookTracker = new WebhookFailureTracker();

// ============================================================================
// 4. Núcleo de Observabilidade (Sentry + JSON estruturado + Fail-Safe)
// ============================================================================

let sentryInitialized = false;

/**
 * Higieniza rigorosamente um evento antes do envio ao Sentry via hook beforeSend.
 * Sanitiza headers, request body, extras, breadcrumbs e exceções.
 */
export function sanitizeSentryEvent<T extends {
  request?: { headers?: Record<string, string>; data?: unknown };
  extra?: Record<string, unknown>;
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  exception?: { values?: Array<{ value?: string }> };
  message?: string;
}>(event: T): T {
  // 1. request headers
  if (event.request?.headers) {
    const sanitizedHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(event.request.headers)) {
      if (isSensitiveKey(key)) {
        sanitizedHeaders[key] = "[REDACTED]";
      } else if (typeof val === "string") {
        sanitizedHeaders[key] = sanitizeStringValue(val);
      } else {
        sanitizedHeaders[key] = val;
      }
    }
    event.request.headers = sanitizedHeaders;
  }

  // 2. request data / body
  if (event.request?.data) {
    if (typeof event.request.data === "string") {
      event.request.data = sanitizeStringValue(event.request.data);
    } else if (typeof event.request.data === "object" && event.request.data !== null) {
      event.request.data = sanitizeObject(event.request.data);
    }
  }

  // 3. extras
  if (event.extra && typeof event.extra === "object") {
    event.extra = sanitizeObject(event.extra) as Record<string, unknown>;
  }

  // 4. breadcrumbs
  if (event.breadcrumbs && Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      const sanitized = { ...breadcrumb };
      if (sanitized.message) {
        sanitized.message = sanitizeStringValue(sanitized.message);
      }
      if (sanitized.data && typeof sanitized.data === "object" && sanitized.data !== null) {
        sanitized.data = sanitizeObject(sanitized.data) as Record<string, unknown>;
      }
      return sanitized;
    });
  }

  // 5. exception values/messages
  if (event.exception?.values && Array.isArray(event.exception.values)) {
    for (const singleException of event.exception.values) {
      if (singleException.value) {
        singleException.value = sanitizeStringValue(singleException.value);
      }
    }
  }

  // 6. event message
  if (event.message) {
    event.message = sanitizeStringValue(event.message);
  }

  return event;
}

function initSentryIfNeeded(): void {
  if (sentryInitialized) return;
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  try {
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_VERSION || undefined,
      tracesSampleRate: 0.1,
      beforeSend(event) {
        return sanitizeSentryEvent(event);
      },
    });
    sentryInitialized = true;
  } catch (err) {
    console.error("Falha ao inicializar Sentry:", err);
  }
}

function getEnvironment(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}

function getRelease(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_VERSION || "development";
}

let activeLogSink: ((entry: StructuredLogEntry) => void) | null = null;
let activeSentryHook: ((exception: unknown, hint?: unknown) => void) | null = null;

export function setLogSinkForTesting(sink: ((entry: StructuredLogEntry) => void) | null): void {
  activeLogSink = sink;
}

export function setSentryHookForTesting(hook: ((exception: unknown, hint?: unknown) => void) | null): void {
  activeSentryHook = hook;
}

export function buildStructuredLog(error: unknown, context: ErrorContext = {}): StructuredLogEntry {
  const level: SeverityLevel = context.level || "error";
  const rawMessage = error instanceof Error ? error.message : String(error);
  // Garante sanitização de error.message antes do log estruturado
  const errorMessage = sanitizeStringValue(rawMessage);
  const errorType = error instanceof Error ? error.name : typeof error;

  const sanitizedExtra = context.extra ? sanitizeObject(context.extra) : undefined;
  const safePaymentId = sanitizePaymentId(context.paymentId);

  return {
    timestamp: new Date().toISOString(),
    level,
    message: errorMessage,
    error_type: errorType,
    route: context.route,
    environment: getEnvironment(),
    release: getRelease(),
    http_status: context.httpStatus,
    rpc_name: context.rpcName,
    payment_id: safePaymentId,
    alert_rule: context.alertRule,
    context: sanitizedExtra,
  };
}

export function captureError(error: unknown, context: ErrorContext = {}): StructuredLogEntry {
  initSentryIfNeeded();

  const logEntry = buildStructuredLog(error, context);

  try {
    if (activeLogSink) {
      activeLogSink(logEntry);
    } else {
      console.error(JSON.stringify(logEntry));
    }
  } catch {
    console.error("[OBSERVABILITY_ERROR]", logEntry.message);
  }

  // Cria SEMPRE uma nova instância de Error higienizada, nunca despachando Error bruto com segredos
  const sanitizedException = createSanitizedException(error, logEntry.message);
  const sentryHint = {
    level: logEntry.level,
    tags: {
      route: logEntry.route || "unknown",
      environment: logEntry.environment,
      rpc_name: logEntry.rpc_name || "none",
      alert_rule: logEntry.alert_rule || "none",
      http_status: logEntry.http_status ? String(logEntry.http_status) : "none",
    },
    extra: {
      payment_id: logEntry.payment_id,
      context: logEntry.context,
    },
    user: context.userId ? { id: context.userId } : undefined,
  };

  if (activeSentryHook) {
    try {
      activeSentryHook(sanitizedException, sentryHint);
    } catch {
      // Ignora falhas no hook de teste
    }
  }

  try {
    if (sentryInitialized) {
      Sentry.captureException(sanitizedException, sentryHint);
    }
  } catch (sentryErr) {
    console.error("Falha ao reportar erro para Sentry:", sentryErr);
  }

  return logEntry;
}

export function captureFinancialRpcError(
  error: unknown,
  context: Omit<ErrorContext, "alertRule" | "level"> & { rpcName: string },
): StructuredLogEntry {
  return captureError(error, {
    ...context,
    alertRule: "financial_rpc_error",
    level: "fatal",
  });
}

export function captureCheckoutError(
  error: unknown,
  context: Omit<ErrorContext, "alertRule" | "level" | "httpStatus"> = {},
): StructuredLogEntry {
  return captureError(error, {
    ...context,
    route: context.route || "/api/mercadopago/checkout",
    httpStatus: 500,
    alertRule: "checkout_5xx",
    level: "error",
  });
}

export function captureSyncError(
  error: unknown,
  context: Omit<ErrorContext, "alertRule" | "level" | "httpStatus"> = {},
): StructuredLogEntry {
  return captureError(error, {
    ...context,
    route: context.route || "/api/mercadopago/sync",
    httpStatus: 500,
    alertRule: "sync_5xx",
    level: "error",
  });
}

export function captureWebhookError(
  error: unknown,
  context: Omit<ErrorContext, "alertRule"> = {},
): StructuredLogEntry {
  const failureStats = webhookTracker.recordFailure();

  // Informação auxiliar por instância
  const isRepeated = failureStats.isRepeated;
  const alertRule = isRepeated ? "webhook_repeated_failure" : undefined;
  const level: SeverityLevel = isRepeated ? "fatal" : context.level || "error";

  // A tag de rota é despachada ao Sentry, onde alertas globais confiáveis são agregados
  return captureError(error, {
    ...context,
    route: context.route || "/api/webhooks/mercadopago",
    alertRule,
    level,
    extra: {
      ...context.extra,
      local_instance_failure_count: failureStats.count,
    },
  });
}
