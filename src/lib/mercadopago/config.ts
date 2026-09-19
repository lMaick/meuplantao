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
