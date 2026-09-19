import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

let mockWebhookSecret = null;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-test-token'; export const getMercadoPagoWebhookSecret = () => globalThis.__mockWebhookSecret ?? null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com';",
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/stripe/supabase") {
      return {
        url: "data:text/javascript,export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { GET: webhookGet, POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");

const validUserId = "22222222-2222-4222-8222-222222222222";

test("webhook GET handles IPN query params (?id=...&topic=payment)", async () => {
  const calls = [];
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  };
  globalThis.adminClient = {
    from: () => ({
      upsert: async (row, options) => {
        calls.push({ row, options });
        return { error: null };
      },
    }),
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago?id=123456789&topic=payment", {
    method: "GET",
  });

  const response = await webhookGet(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, processed: true });
  assert.equal(calls[0], "https://api.mercadopago.test/v1/payments/123456789");
  assert.deepEqual(calls[1], { row: { user_id: validUserId, status: "active" }, options: { onConflict: "user_id" } });
});

test("webhook GET handles IPN query params (?data.id=...&type=payment)", async () => {
  const calls = [];
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  };
  globalThis.adminClient = {
    from: () => ({
      upsert: async (row, options) => {
        calls.push({ row, options });
        return { error: null };
      },
    }),
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago?data.id=987654321&type=payment", {
    method: "GET",
  });

  const response = await webhookGet(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, processed: true });
  assert.equal(calls[0], "https://api.mercadopago.test/v1/payments/987654321");
});

test("webhook POST handles JSON body with resource URL", async () => {
  const calls = [];
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  };
  globalThis.adminClient = {
    from: () => ({
      upsert: async (row, options) => {
        calls.push({ row, options });
        return { error: null };
      },
    }),
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: "payment",
      resource: "https://api.mercadolibre.com/v1/payments/5544332211",
    }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, processed: true });
  assert.equal(calls[0], "https://api.mercadopago.test/v1/payments/5544332211");
});

test("webhook validates HMAC x-signature when secret is set", async () => {
  const secret = "super-secret-key";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "778899";
  const requestId = "req-12345";
  const timestamp = "1700000000";
  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  const validHash = createHmac("sha256", secret).update(manifest).digest("hex");

  // 1. Invalid signature
  const invalidRequest = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${timestamp},v1=invalidhash`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const invalidResponse = await webhookPost(invalidRequest);
  assert.equal(invalidResponse.status, 401);

  // 2. Valid signature
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  globalThis.adminClient = { from: () => ({ upsert: async () => ({ error: null }) }) };

  const validRequest = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${timestamp},v1=${validHash}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const validResponse = await webhookPost(validRequest);
  assert.equal(validResponse.status, 200);
  assert.deepEqual(await validResponse.json(), { received: true, processed: true });

  globalThis.__mockWebhookSecret = null;
});

test("webhook returns 200 ignored for non-approved payments or missing user_id", async () => {
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "pending", external_reference: validUserId }), { status: 200 });

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ data: { id: "payment-pending" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.ignored, true);
});
