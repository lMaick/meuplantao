import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __mpRoutesFile = fileURLToPath(import.meta.url);
const __mpTrialUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "subscription", "trial.ts")).href;
const __mpPaymentsUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "mercadopago", "payments.ts")).href;
const __mpWebhookUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "mercadopago", "webhook.ts")).href;
const __mpObservabilityUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "observability", "index.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __mpObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") {
      return { url: __mpTrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return { url: __mpPaymentsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/webhook") {
      return { url: __mpWebhookUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") return { url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-token'; export const getMercadoPagoWebhookSecret = () => null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com'; export const isProductionEnvironment = () => process.env.VERCEL_ENV?.trim() === 'production' || process.env.NODE_ENV?.trim() === 'production'; export const isMissingWebhookSecretAllowed = () => { if (isProductionEnvironment()) return false; const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase(); return raw !== 'false' && raw !== '0' && raw !== 'no'; }; export const getWebhookSetupState = () => ({ configured: false, failClosed: !isMissingWebhookSecretAllowed() });", shortCircuit: true };
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") return { url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: checkout } = await import("../src/app/api/mercadopago/checkout/route.ts");
const { POST: webhook } = await import("../src/app/api/webhooks/mercadopago/route.ts");

const userId = "11111111-1111-4111-8111-111111111111";

function checkoutRequest() {
  return new Request("http://localhost/api/mercadopago/checkout", { method: "POST" });
}

function authenticatedClient(subscription = null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: subscription, error: null }) }) }) }),
  };
}

test("checkout creates a Mercado Pago preference for the authenticated user", async () => {
  const calls = [];
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ init_point: "https://www.mercadopago.com/checkout/v1" }), { status: 201 });
  };

  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { init_point: "https://www.mercadopago.com/checkout/v1" });
  assert.equal(calls[0].url, "https://api.mercadopago.test/checkout/preferences");
  assert.equal(calls[0].options.headers.Authorization, "Bearer mp-token");
  assert.equal(calls[0].body.items[0].unit_price, 12.9);
  assert.equal(calls[0].body.external_reference, userId);
  assert.equal(calls[0].body.back_urls.success, "https://app.example.com/configuracoes?payment=success");
});

test("checkout allows active users to extend/renew their subscription without 409", async () => {
  const calls = [];
  globalThis.authenticatedClient = authenticatedClient({ status: "active", current_period_end: "2026-12-01T00:00:00Z" });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ init_point: "https://www.mercadopago.com/checkout/renew" }), { status: 201 });
  };

  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { init_point: "https://www.mercadopago.com/checkout/renew" });
  assert.equal(calls[0].body.metadata.is_renewal, true);
});

test("webhook ignores non-payment notifications", async () => {
  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body: JSON.stringify({ type: "merchant_order", data: { id: "order-1" } }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, ignored: true });
});

test("approved payment activates the user's subscription", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ status: "approved", external_reference: userId }), { status: 200 });
  };
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      calls.push({ fn, params });
      return {
        data: {
          already_processed: false,
          current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
          validity_days_added: 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-1" } }),
  }));
  const webhookJson = await response.json();
  assert.equal(webhookJson.received, true);
  assert.equal(webhookJson.processed, true);
  assert.ok(webhookJson.current_period_end, "MAI-126: webhook deve retornar current_period_end");
  assert.equal(calls[0], "https://api.mercadopago.test/v1/payments/payment-1");
  const rpcCall = calls.find((c) => c && c.fn === "process_mercadopago_subscription_payment");
  assert.ok(rpcCall, "webhook deve chamar a RPC atômica process_mercadopago_subscription_payment");
  assert.equal(rpcCall.params.p_user_id, userId);
  assert.equal(rpcCall.params.p_payment_id, "payment-1");
});
