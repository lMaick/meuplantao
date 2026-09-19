import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "stripe") return { url: "data:text/javascript,export default class Stripe {}", shortCircuit: true };
    if (specifier === "@/lib/stripe/config") return { url: "data:text/javascript,export const getStripeClient = () => globalThis.stripeClient; export const getStripeWebhookSecret = () => 'whsec_test'; export const getMonthlyPriceId = () => 'price_monthly'; export const getApplicationOrigin = () => 'http://localhost';", shortCircuit: true };
    if (specifier === "@/lib/stripe/supabase") return { url: "data:text/javascript,export const createAdminClient = () => globalThis.adminClient; export const createAuthenticatedClient = () => globalThis.authenticatedClient;", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: checkout } = await import("../src/app/api/stripe/checkout/route.ts");
const { POST: webhook } = await import("../src/app/api/webhooks/stripe/route.ts");

function checkoutRequest() {
  return new (globalThis.NextRequest ?? class extends Request {})("http://localhost/api/stripe/checkout", { method: "POST" });
}

test("checkout creates a monthly subscription session for the authenticated user", async () => {
  const calls = [];
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  globalThis.stripeClient = { checkout: { sessions: { create: async (params) => { calls.push(params); return { url: "https://checkout.stripe.com/session" }; } } } };
  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://checkout.stripe.com/session");
  assert.deepEqual(calls[0], {
    mode: "subscription",
    line_items: [{ price: "price_monthly", quantity: 1 }],
    customer: undefined,
    client_reference_id: "user-1",
    metadata: { user_id: "user-1" },
    subscription_data: { metadata: { user_id: "user-1" } },
    success_url: "http://localhost/configuracoes?stripe=success",
    cancel_url: "http://localhost/configuracoes?stripe=cancelled",
  });
});

test("webhook rejects an invalid Stripe signature", async () => {
  globalThis.stripeClient = { webhooks: { constructEvent: () => { throw new Error("invalid"); } } };
  const response = await webhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}", headers: { "stripe-signature": "bad" } }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Assinatura Stripe invalida" });
});

test("webhook verifies the raw body and sends a subscription event to the atomic RPC", async () => {
  const calls = [];
  globalThis.stripeClient = {
    webhooks: { constructEvent: (body, signature, secret) => {
      assert.equal(body, "signed-body");
      assert.equal(signature, "sig");
      assert.equal(secret, "whsec_test");
      return { id: "evt_1", type: "customer.subscription.updated", data: { object: {
        id: "sub_1", customer: "cus_1", status: "active", metadata: { user_id: "user-1" },
        items: { data: [{ price: { id: "price_monthly" }, current_period_end: 1790000000 }] }, cancel_at_period_end: false,
      } } };
    } },
  };
  globalThis.adminClient = { rpc: async (name, params) => { calls.push({ name, params }); return { data: true, error: null }; } };
  const response = await webhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "signed-body", headers: { "stripe-signature": "sig" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, processed: true });
  assert.equal(calls[0].name, "process_stripe_subscription_event");
  assert.equal(calls[0].params.p_event_id, "evt_1");
  assert.equal(calls[0].params.p_user_id, "user-1");
  assert.equal(calls[0].params.p_status, "active");
});

test("repeated webhook event is acknowledged without a second update", async () => {
  globalThis.stripeClient = { webhooks: { constructEvent: () => ({ id: "evt_1", type: "customer.subscription.updated", data: { object: {
    id: "sub_1", customer: "cus_1", status: "active", metadata: { user_id: "user-1" }, items: { data: [] }, cancel_at_period_end: false,
  } } }) } };
  globalThis.adminClient = { rpc: async () => ({ data: false, error: null }) };
  const response = await webhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "signed-body", headers: { "stripe-signature": "sig" } }));
  assert.deepEqual(await response.json(), { received: true, processed: false });
});
