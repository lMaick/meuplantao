const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";

function requiredEnv(name: "MERCADO_PAGO_ACCESS_TOKEN"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configuracao Mercado Pago ausente: ${name}`);
  return value;
}

export function getMercadoPagoAccessToken(): string {
  return requiredEnv("MERCADO_PAGO_ACCESS_TOKEN");
}

export function getMercadoPagoWebhookSecret(): string | null {
  return process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim() || null;
}

export function getApplicationOrigin(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = configured || new URL(requestUrl).origin;
  const parsed = new URL(origin);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Origem da aplicacao invalida");
  }
  return parsed.origin;
}

export function getMercadoPagoApiUrl(): string {
  return MERCADO_PAGO_API_URL;
}

export function paymentBelongsToUser(
  p: { external_reference?: string | null; metadata?: { user_id?: string | null; userId?: string | null } | null },
  userId: string,
): boolean {
  if (!userId || !p) return false;
  const rawRef = (p.external_reference || "").trim();
  const [paymentUserId] = rawRef ? rawRef.split("#") : [""];
  const metadataUserId = (p.metadata?.user_id || p.metadata?.userId || "").trim();

  const hasRef = Boolean(paymentUserId);
  const hasMeta = Boolean(metadataUserId);

  if (!hasRef && !hasMeta) return false;

  if (hasRef && hasMeta) {
    return paymentUserId === userId && metadataUserId === userId;
  }

  if (hasRef) {
    return paymentUserId === userId;
  }

  return metadataUserId === userId;
}

export function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV?.trim() === "production" || process.env.NODE_ENV?.trim() === "production";
}

export function isMissingWebhookSecretAllowed(): boolean {
  if (isProductionEnvironment()) {
    return false;
  }
  const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export interface WebhookSetupState {
  configured: boolean;
  failClosed: boolean;
}
export function getWebhookSetupState(): WebhookSetupState {
  if (getMercadoPagoWebhookSecret()) {
    return { configured: true, failClosed: false };
  }
  return { configured: false, failClosed: !isMissingWebhookSecretAllowed() };
}

export const LEGACY_IPN_DISABLED_CODE = "legacy_ipn_disabled";
export const LEGACY_IPN_DISABLED_PUBLIC_ERROR = "IPN legado desabilitado";

/**
 * MAI-138 — Kill-switch explícito do IPN legado (sem assinatura).
 * Em produção o IPN legado é DESABILITADO por padrão (410 Gone, sem consultar
 * o Mercado Pago); fora de produção permanece habilitado para dev/teste.
 * `MERCADO_PAGO_ENABLE_LEGACY_IPN=true` habilita explicitamente em qualquer
 * ambiente; `=false` desabilita em qualquer ambiente.
 */
export function isLegacyIpnEnabled(): boolean {
  const raw = process.env.MERCADO_PAGO_ENABLE_LEGACY_IPN?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return !isProductionEnvironment();
}
