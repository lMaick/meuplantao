/**
 * Coleta de violações CSP — MAI-145.
 *
 * Lógica pura do endpoint `/api/csp-report` (a rota em
 * `src/app/api/csp-report/route.ts` é um wrapper fino).
 *
 * Garantias anti-abuso e anti-PII:
 * - Corpo limitado a 8 KB (rejeitado com 413 acima disso).
 * - Rate limit in-memory por IP (10 req/min; 429 acima disso). Best-effort por
 *   instância — suficiente para telemetria, sem writes em banco a partir de um
 *   endpoint público não autenticado (evita vetor de abuso contra Supabase).
 * - Sanitização: apenas campos allowlist são registrados; query strings,
 *   fragmentos, cookies, Authorization e tokens nunca são persistidos/logados.
 *   URLs completas são reduzidas a origem (`https://host`) ou pathname.
 *   `original-policy` NUNCA é coletado (auditoria MAI-145: pode carregar
 *   nonces ou URLs com parâmetros sensíveis; irrelevante para agrupar
 *   violações por diretiva/host).
 */

export const CSP_REPORT_MAX_BYTES = 8192;
export const CSP_REPORT_WINDOW_MS = 60_000;
export const CSP_REPORT_MAX_PER_WINDOW = 10;

export const CSP_REPORT_ALLOWED_CONTENT_TYPES = [
  "application/csp-report",
  "application/reports+json",
  "application/json",
] as const;

export interface SanitizedCspReport {
  violatedDirective: string;
  effectiveDirective: string;
  blockedHost: string;
  documentPath: string;
  sourcePath?: string;
  lineNumber?: number;
  columnNumber?: number;
}

/**
 * Tamanho real em bytes (UTF-8) do corpo — `String.length` conta caracteres
 * e subestima payloads multibyte. Compara contra `CSP_REPORT_MAX_BYTES`.
 */
export function getCspReportBodyByteLength(raw: string): number {
  try {
    if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
      return Buffer.byteLength(raw, "utf8");
    }
  } catch {
    // Fallback conservador abaixo.
  }
  return raw.length;
}

export function isCspReportBodyTooLarge(raw: string): boolean {
  return getCspReportBodyByteLength(raw) > CSP_REPORT_MAX_BYTES;
}

export type SanitizeResult =
  | { ok: true; report: SanitizedCspReport }
  | { ok: false; error: "invalid-shape" | "missing-directive" };

const SENSITIVE_PATTERN =
  /token|secret|password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|cookie|session|credential/i;

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function redactIfSensitive(value: string): string {
  return SENSITIVE_PATTERN.test(value) ? "[REDACTED]" : value;
}

/** Reduz `blocked-uri` a origem/host ou esquema — nunca query/fragment. */
export function safeBlockedHost(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const value = raw.trim().slice(0, 500);
  if (!value) return "unknown";
  const lower = value.toLowerCase();
  if (lower === "self" || value === "'self'") return "self";
  if (lower === "inline") return "inline";
  if (lower.startsWith("data:")) return "data:";
  if (lower.startsWith("blob:")) return "blob:";
  if (value.startsWith("/")) {
    const path = value.split(/[?#]/)[0];
    return `self:${truncate(path, 100) || "/"}`;
  }
  try {
    const parsed = new URL(value);
    if (!["http:", "https:", "wss:", "ws:"].includes(parsed.protocol)) return parsed.protocol.replace(/:$/, "") + ":";
    return redactIfSensitive(`${parsed.protocol}//${parsed.host}`.slice(0, 200));
  } catch {
    return redactIfSensitive(truncate(value.split(/[?#]/)[0], 100)) || "unknown";
  }
}

/** Reduz `document-uri`/`source-file` ao pathname — nunca query/fragment. */
export function safeDocumentPath(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const value = raw.trim().slice(0, 500);
  if (!value) return "unknown";
  const withoutQuery = value.split(/[?#]/)[0];
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(withoutQuery)) {
      const parsed = new URL(withoutQuery);
      return redactIfSensitive(truncate(parsed.pathname || "/", 200)) || "/";
    }
    return redactIfSensitive(truncate(withoutQuery || "/", 200)) || "/";
  } catch {
    return "unknown";
  }
}

function toFiniteInt(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n >= 0 && n <= 1_000_000 ? n : undefined;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : undefined;
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** Extrai o objeto de report dos formatos `report-uri` e Reporting API. */
function extractPayload(input: unknown): Record<string, unknown> | null {
  if (Array.isArray(input)) {
    const first = input[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== "object") return null;
    const body = (first as Record<string, unknown>).body;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return first as Record<string, unknown>;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const nested = obj["csp-report"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  const reports = obj["reports"];
  if (Array.isArray(reports) && reports.length > 0) {
    const first = reports[0] as Record<string, unknown>;
    if (first && typeof first === "object") {
      const body = first["body"];
      if (body && typeof body === "object" && !Array.isArray(body)) {
        return body as Record<string, unknown>;
      }
      return first;
    }
  }
  return obj;
}

export function sanitizeCspReport(input: unknown): SanitizeResult {
  const payload = extractPayload(input);
  if (!payload) return { ok: false, error: "invalid-shape" };

  const violated = pickString(payload, "violated-directive", "violatedDirective");
  const effective = pickString(payload, "effective-directive", "effectiveDirective");
  const directive = violated ?? effective;
  if (!directive) return { ok: false, error: "missing-directive" };

  const violatedDirective = redactIfSensitive(truncate(violated ?? effective ?? "", 100));
  const effectiveDirective = redactIfSensitive(truncate(effective ?? violated ?? "", 100));

  const blockedHost = safeBlockedHost(
    payload["blocked-uri"] ?? payload["blockedURI"] ?? payload["blockedUri"],
  );
  const documentPath = safeDocumentPath(
    payload["document-uri"] ?? payload["documentURI"] ?? payload["documentUri"],
  );

  const rawSource = pickString(payload, "source-file", "sourceFile");
  const sourcePath = rawSource ? safeDocumentPath(rawSource) : undefined;
  const lineNumber = toFiniteInt(payload["line-number"] ?? payload["lineNumber"]);
  const columnNumber = toFiniteInt(payload["column-number"] ?? payload["columnNumber"]);

  // `original-policy` é descartado intencionalmente (ver comentário do módulo).

  return {
    ok: true,
    report: {
      violatedDirective,
      effectiveDirective,
      blockedHost,
      documentPath,
      ...(sourcePath ? { sourcePath } : {}),
      ...(lineNumber !== undefined ? { lineNumber } : {}),
      ...(columnNumber !== undefined ? { columnNumber } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Rate limit in-memory por IP (best-effort por instância)
// ---------------------------------------------------------------------------

const buckets = new Map<string, number[]>();

export function normalizeCspReportIp(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const first = raw.split(",")[0].trim().slice(0, 100);
  return first || "unknown";
}

export function checkCspReportRateLimit(
  ip: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const key = normalizeCspReportIp(ip);
  const windowStart = now - CSP_REPORT_WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= CSP_REPORT_MAX_PER_WINDOW) {
    const oldest = hits[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + CSP_REPORT_WINDOW_MS - now) / 1000));
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetCspReportRateLimitForTests(): void {
  buckets.clear();
}

export function isAllowedCspContentType(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const mime = raw.split(";")[0].trim().toLowerCase();
  return (CSP_REPORT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(mime);
}
