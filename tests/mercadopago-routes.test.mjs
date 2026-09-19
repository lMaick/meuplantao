import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") return { url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-token'; export const getMercadoPagoWebhookSecret = () => null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com';", shortCircuit: true };
    if (specifier === "@/lib/stripe/supabase") return { url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;", shortCircuit: true };
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

test("checkout blocks an existing active subscription", async () => {
  globalThis.authenticatedClient = authenticatedClient({ status: "active" });
  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 409);
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
  globalThis.adminClient = { from: () => ({ upsert: async (row, options) => { calls.push({ row, options }); return { error: null }; } }) };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-1" } }),
  }));
  assert.deepEqual(await response.json(), { received: true, processed: true });
  assert.equal(calls[0], "https://api.mercadopago.test/v1/payments/payment-1");
  assert.deepEqual(calls[1], { row: { user_id: userId, status: "active" }, options: { onConflict: "user_id" } });
});
