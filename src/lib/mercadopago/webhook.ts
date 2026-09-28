import { createHmac, timingSafeEqual } from "node:crypto";
import { getMercadoPagoWebhookSecret } from "@/lib/mercadopago/config";

export const WEBHOOK_NOT_CONFIGURED_CODE = "webhook_not_configured";
export const WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR = "Webhook indisponível no momento";

export function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export interface ExtractedPaymentInfo {
  typeOrTopic?: string;
  paymentId?: string;
  bodyJson: {
    type?: string;
    topic?: string;
    action?: string;
    resource?: string;
    id?: string | number;
    data?: { id?: string | number };
  };
}

export function extractPaymentInfo(request: Request, rawBody: string): ExtractedPaymentInfo {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  let bodyJson: ExtractedPaymentInfo["bodyJson"] = {};

  if (rawBody && rawBody.trim()) {
    try {
      bodyJson = JSON.parse(rawBody);
    } catch {
      // Ignora erro de parse de JSON se o payload for vazio ou querystring
    }
  }

  const typeOrTopic =
    searchParams.get("type") ||
    searchParams.get("topic") ||
    bodyJson.type ||
    bodyJson.topic ||
    bodyJson.action;

  let paymentId =
    searchParams.get("data.id") ||
    searchParams.get("data[id]") ||
    searchParams.get("id") ||
    searchParams.get("payment_id") ||
    searchParams.get("collection_id") ||
    bodyJson.data?.id?.toString() ||
    bodyJson.id?.toString();

  if (!paymentId && typeof bodyJson.resource === "string") {
    const match = bodyJson.resource.match(/\/payments\/([^/?#]+)/i);
    if (match) paymentId = match[1];
  }
  if (!paymentId && typeof searchParams.get("resource") === "string") {
    const match = (searchParams.get("resource") || "").match(/\/payments\/([^/?#]+)/i);
    if (match) paymentId = match[1];
  }

  return { typeOrTopic, paymentId, bodyJson };
}

export interface SignatureValidationResult {
  valid: boolean;
  code?: string;
  error?: string;
}

function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV?.trim() === "production" || process.env.NODE_ENV?.trim() === "production";
}

function isMissingSecretBypassAllowed(): boolean {
  if (isProductionEnvironment()) {
    return false;
  }
  const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

/**
 * Validação estrita de assinatura HMAC do Mercado Pago (x-signature e x-request-id)
 * com proteção contra replay attacks (janela de timestamp ts).
 */
export function validateWebhookSignature(
  request: Request,
  paymentId: string | undefined,
  options: { maxAgeSeconds?: number } = {},
): SignatureValidationResult {
  const secret = getMercadoPagoWebhookSecret();

  if (!secret) {
    if (isMissingSecretBypassAllowed()) {
      return { valid: true };
    }
    return { valid: false, code: WEBHOOK_NOT_CONFIGURED_CODE, error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR };
  }

  // Quando o segredo está configurado, a assinatura é OBRIGATÓRIA
  const signature = request.headers.get("x-signature");
  if (!signature) {
    return { valid: false, error: "Assinatura Mercado Pago ausente (header x-signature obrigatorio)" };
  }

  const requestId = request.headers.get("x-request-id");
  if (!requestId) {
    return { valid: false, error: "Identificador da requisicao ausente (header x-request-id obrigatorio)" };
  }

  const values = new Map(
    signature
      .split(",")
      .map((part) => part.trim().split("=", 2) as [string, string]),
  );
  const timestamp = values.get("ts");
  const receivedHash = values.get("v1");

  if (!timestamp || !receivedHash || !paymentId) {
    return { valid: false, error: "Formato de x-signature invalido ou identificador do pagamento ausente" };
  }

  // Proteção contra ataques de Replay
  const maxAgeSeconds = options.maxAgeSeconds ?? 300; // 5 minutos padrão
  const tsNumber = Number(timestamp);

  if (!Number.isFinite(tsNumber) || tsNumber <= 0) {
    return { valid: false, error: "Timestamp ts em x-signature invalido" };
  }

  const tsMs = tsNumber < 1e11 ? tsNumber * 1000 : tsNumber;
  const driftSeconds = Math.abs(Date.now() - tsMs) / 1000;

  if (driftSeconds > maxAgeSeconds) {
    return { valid: false, error: "Notificacao expirada (replay detectado)" };
  }

  // Cálculo HMAC-SHA256
  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"), "utf8");
  const received = Buffer.from(receivedHash, "utf8");

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { valid: false, error: "Assinatura Mercado Pago invalida" };
  }

  return { valid: true };
}
