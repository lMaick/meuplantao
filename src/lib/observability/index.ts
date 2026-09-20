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

const JWT_PATTERN = /^ey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}$/;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function sanitizeStringValue(value: string): string {
  const trimmed = value.trim();
  if (JWT_PATTERN.test(trimmed)) {
    return "[REDACTED_TOKEN]";
  }
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return "Bearer [REDACTED]";
  }
  if (trimmed.length > 50 && (/eyJ/i.test(trimmed) || /sbp_/i.test(trimmed))) {
    return "[REDACTED_SECRET]";
  }
  return value;
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

// ============================================================================
// 3. Rastreamento e Detecção de Anomalias (Alertas Agregados)
// ============================================================================

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
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
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

export function setLogSinkForTesting(sink: ((entry: StructuredLogEntry) => void) | null): void {
  activeLogSink = sink;
}

export function buildStructuredLog(error: unknown, context: ErrorContext = {}): StructuredLogEntry {
  const level: SeverityLevel = context.level || "error";
  const errorMessage = error instanceof Error ? error.message : String(error);
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

  try {
    if (sentryInitialized) {
      const exception = error instanceof Error ? error : new Error(logEntry.message);
      Sentry.captureException(exception, {
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
      });
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
  const { isRepeated } = webhookTracker.recordFailure();

  const alertRule = isRepeated ? "webhook_repeated_failure" : undefined;
  const level: SeverityLevel = isRepeated ? "fatal" : context.level || "error";

  return captureError(error, {
    ...context,
    route: context.route || "/api/webhooks/mercadopago",
    alertRule,
    level,
  });
}
