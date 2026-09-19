import Stripe from "stripe";

function requiredEnv(name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "STRIPE_PRICE_ID_MONTHLY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configuracao Stripe ausente: ${name}`);
  return value;
}

export function getStripeClient(): Stripe {
  return new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
}

export function getStripeWebhookSecret(): string {
  return requiredEnv("STRIPE_WEBHOOK_SECRET");
}

export function getMonthlyPriceId(): string {
  return requiredEnv("STRIPE_PRICE_ID_MONTHLY");
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
