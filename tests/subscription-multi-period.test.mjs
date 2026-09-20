import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const userId = "11111111-1111-4111-8111-111111111111";
const subscriptionTypesUrl = pathToFileURL(resolve("src/lib/subscription/types.ts")).href;
const subscriptionTrialUrl = pathToFileURL(resolve("src/lib/subscription/trial.ts")).href;
const subscriptionPaymentsUrl = pathToFileURL(resolve("src/lib/mercadopago/payments.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") return { url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-token'; export const getMercadoPagoWebhookSecret = () => null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com';", shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: subscriptionPaymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/stripe/supabase") return { url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;", shortCircuit: true };
    if (specifier === "@/lib/subscription/types") return { url: subscriptionTypesUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: subscriptionTrialUrl, shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: checkout } = await import("../src/app/api/mercadopago/checkout/route.ts");
const { POST: webhook } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { addSubscriptionValidity, getSubscriptionPeriod } = await import("../src/lib/subscription/types.ts");

function authenticatedClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
}

function checkoutRequest(months) {
  return new Request("http://localhost/api/mercadopago/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ months }),
  });
}

for (const expected of [
  [1, 12.9, 30],
  [3, 38.7, 90],
  [6, 69.9, 180],
  [12, 129.9, 365],
]) {
  test(`checkout creates the ${expected[0]} month package`, async () => {
    const calls = [];
    globalThis.authenticatedClient = authenticatedClient();
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ init_point: "https://mercadopago.test/checkout" }), { status: 201 });
    };

    const response = await checkout(checkoutRequest(expected[0]));
    const body = calls[0].body;
    assert.equal(response.status, 200);
    assert.equal(body.items[0].unit_price, expected[1]);
    assert.equal(body.external_reference, userId);
    assert.equal(body.metadata.months, expected[0]);
  });
}

test("subscription validity accumulates from an active period end", () => {
  const currentEnd = new Date("2026-01-01T12:00:00.000Z");
  assert.equal(addSubscriptionValidity(currentEnd, getSubscriptionPeriod(6).validityDays).toISOString(), "2026-06-30T12:00:00.000Z");
  assert.equal(addSubscriptionValidity(currentEnd, getSubscriptionPeriod(12).validityDays).toISOString(), "2027-01-01T12:00:00.000Z");
});

test("webhook activates a multi-period payment with cumulative validity", async () => {
  const calls = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "approved", external_reference: userId, metadata: { user_id: userId, months: 6 } }), { status: 200 });
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      calls.push(params);
      return {
        data: {
          already_processed: false,
          current_period_end: "2027-05-30T00:00:00.000Z",
          validity_days_added: 180,
          status: "active",
        },
        error: null,
      };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body: JSON.stringify({ type: "payment", data: { id: "payment-6" } }) }));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.current_period_end, "2027-05-30T00:00:00.000Z");
  assert.equal(calls[0].p_validity_days, 180);
});

test("checkout rejects unsupported periods", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  const response = await checkout(checkoutRequest(2));
  assert.equal(response.status, 400);
});
