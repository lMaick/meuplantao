import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __setupFile = fileURLToPath(import.meta.url);
const __billingRateLimitUrl = pathToFileURL(path.join(path.dirname(__setupFile), "..", "src", "lib", "billing", "rate-limit.ts")).href;
const __setupDir = path.dirname(__setupFile);

const __setupTrialUrl = pathToFileURL(path.join(__setupDir, "..", "src", "lib", "subscription", "trial.ts")).href;
const __setupPaymentsUrl = pathToFileURL(path.join(__setupDir, "..", "src", "lib", "mercadopago", "payments.ts")).href;
const __setupReversalsUrl = pathToFileURL(path.join(__setupDir, "..", "src", "lib", "mercadopago", "reversals.ts")).href;
const __setupWebhookUrl = pathToFileURL(path.join(__setupDir, "..", "src", "lib", "mercadopago", "webhook.ts")).href;
const __setupObservabilityUrl = pathToFileURL(path.join(__setupDir, "..", "src", "lib", "observability", "index.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/billing/rate-limit") return { url: __billingRateLimitUrl, shortCircuit: true };
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __setupObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: __setupTrialUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: __setupPaymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/reversals") return { url: __setupReversalsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: __setupWebhookUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-test-token'; export const getMercadoPagoWebhookSecret = () => globalThis.__mockWebhookSecret ?? null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com'; export const isProductionEnvironment = () => process.env.VERCEL_ENV?.trim() === 'production' || process.env.NODE_ENV?.trim() === 'production'; export const isMissingWebhookSecretAllowed = () => { if (isProductionEnvironment()) return false; const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase(); return raw !== 'false' && raw !== '0' && raw !== 'no'; }; export const getWebhookSetupState = () => { if (globalThis.__mockWebhookSecret) return { configured: true, failClosed: false }; return { configured: false, failClosed: !isMissingWebhookSecretAllowed() }; }",
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") {
      return {
        url: "data:text/javascript,export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const realConfig = await import(pathToFileURL(path.join(__setupDir, "..", "src", "lib", "mercadopago", "config.ts")).href);
const { GET: webhookGet, POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { WEBHOOK_NOT_CONFIGURED_CODE, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR, validateWebhookSignature } = await import("../src/lib/mercadopago/webhook.ts");

const validUserId = "33333333-3333-4333-8333-333333333333";
const originalFetch = globalThis.fetch;
const ENV_KEYS = ["VERCEL_ENV", "NODE_ENV", "MERCADO_PAGO_WEBHOOK_SECRET", "MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET"];

function snapshotEnv() {
  const snap = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function applyEnv(patch) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function restoreEnv(snap) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = originalFetch;
  globalThis.adminClient = undefined;
}

function sign(paymentId, requestId, timestamp, secret) {
  return createHmac("sha256", secret).update(`id:${paymentId};request-id:${requestId};ts:${timestamp};`).digest("hex");
}

function paymentRequest(paymentId, headers = {}) {
  return new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
  });
}

function mockApprovedPayment() {
  const checkoutId = "00000000-0000-4000-8000-000000000999";
  globalThis.fetch = async (url) => {
    assert.match(url, /^https:\/\/api\.mercadopago\.test\/v1\/payments\//);
    return new Response(
      JSON.stringify({
        status: "approved",
        external_reference: `${validUserId}#pro_monthly#${checkoutId}`,
        transaction_amount: 12.9,
        currency_id: "BRL",
        metadata: {
          user_id: validUserId,
          checkout_id: checkoutId,
        },
      }),
      { status: 200 },
    );
  };
  let rpcCalls = 0;
  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async (fn) => {
      rpcCalls++;
      assert.equal(fn, "process_mercadopago_subscription_payment");
      return {
        data: {
          already_processed: rpcCalls > 1,
          current_period_end: futureEnd,
          validity_days_added: rpcCalls > 1 ? 0 : 30,
          status: "active",
        },
        error: null,
      };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: checkoutId,
                user_id: validUserId,
                plan_id: "pro_monthly",
                price_cents: 1290,
                currency: "BRL",
                completed_payment_id: null,
                expires_at: new Date(Date.now() + 86400000).toISOString(),
              },
              error: null,
            }),
          }),
          maybeSingle: async () => ({
            data: {
              id: checkoutId,
              user_id: validUserId,
              plan_id: "pro_monthly",
              price_cents: 1290,
              currency: "BRL",
              completed_payment_id: null,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: checkoutId }, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
  return { getRpcCalls: () => rpcCalls, futureEnd };
}

test("setup: production without secret fails closed at config level", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test" });
    assert.equal(realConfig.isProductionEnvironment(), false);
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: false, failClosed: false });

    applyEnv({ NODE_ENV: "test", VERCEL_ENV: "production" });
    assert.equal(realConfig.isProductionEnvironment(), true);
    assert.equal(realConfig.isMissingWebhookSecretAllowed(), false);
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: false, failClosed: true });

    applyEnv({ NODE_ENV: "production" });
    assert.equal(realConfig.isProductionEnvironment(), true);
    assert.equal(realConfig.isMissingWebhookSecretAllowed(), false);
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: false, failClosed: true });
  } finally {
    restoreEnv(snap);
  }
});

test("setup: configured secret never fails closed and dev bypass stays out of production", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test", VERCEL_ENV: "production", MERCADO_PAGO_WEBHOOK_SECRET: "s3cret" });
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: true, failClosed: false });

    applyEnv({ NODE_ENV: "test", VERCEL_ENV: "production", MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET: "true" });
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: false, failClosed: true });

    applyEnv({ NODE_ENV: "test" });
    assert.equal(realConfig.isMissingWebhookSecretAllowed(), true);
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: false, failClosed: false });

    applyEnv({ NODE_ENV: "test", MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET: "false" });
    assert.equal(realConfig.isMissingWebhookSecretAllowed(), false);
    assert.deepEqual(realConfig.getWebhookSetupState(), { configured: false, failClosed: true });
  } finally {
    restoreEnv(snap);
  }
});

test("setup: production without secret returns generic 503 before any Mercado Pago API call", async () => {
  for (const prod of [{ VERCEL_ENV: "production", NODE_ENV: "test" }, { NODE_ENV: "production" }]) {
    const snap = snapshotEnv();
    try {
      applyEnv(prod);
      globalThis.__mockWebhookSecret = null;
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        return new Response("{}", { status: 200 });
      };

      const response = await webhookPost(paymentRequest("payment-prod-no-secret"));
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.deepEqual(body, { error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR });
      assert.equal(fetchCalls, 0);
      const serialized = JSON.stringify(body);
      for (const leaked of ["MERCADO_PAGO", "VERCEL", "NODE_ENV", "secret", "stack", "production"]) {
        assert.ok(!serialized.includes(leaked), `public error must not leak ${leaked}`);
      }

      const getResponse = await webhookGet(new Request("http://localhost/api/webhooks/mercadopago?type=payment", { method: "GET" }));
      assert.equal(getResponse.status, 503);
      assert.deepEqual(await getResponse.json(), { error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR });
      assert.equal(fetchCalls, 0);
    } finally {
      restoreEnv(snap);
    }
  }
});

test("setup: production gate stays fail-closed through the centralized policy even with explicit opt-in", async () => {
  for (const prod of [{ VERCEL_ENV: "production", NODE_ENV: "test", MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET: "true" }, { NODE_ENV: "production", MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET: "true" }]) {
    const snap = snapshotEnv();
    try {
      applyEnv(prod);
      globalThis.__mockWebhookSecret = null;
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        return new Response("{}", { status: 200 });
      };
      const response = await webhookPost(paymentRequest("payment-prod-optin-ignored"));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR });
      assert.equal(fetchCalls, 0);
      const direct = validateWebhookSignature(paymentRequest("payment-prod-optin-ignored"), "payment-prod-optin-ignored");
      assert.equal(direct.valid, false);
      assert.equal(direct.code, WEBHOOK_NOT_CONFIGURED_CODE);
    } finally {
      restoreEnv(snap);
    }
  }
});

test("setup: validator reports not-configured code in production without secret", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test", VERCEL_ENV: "production" });
    globalThis.__mockWebhookSecret = null;
    const result = validateWebhookSignature(paymentRequest("payment-code-1"), "payment-code-1");
    assert.equal(result.valid, false);
    assert.equal(result.code, WEBHOOK_NOT_CONFIGURED_CODE);
    assert.equal(result.error, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR);

    applyEnv({ NODE_ENV: "test" });
    const devResult = validateWebhookSignature(paymentRequest("payment-code-2"), "payment-code-2");
    assert.equal(devResult.valid, true);
  } finally {
    restoreEnv(snap);
  }
});

test("setup: missing signature is rejected when secret is configured", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test" });
    globalThis.__mockWebhookSecret = "test-setup-secret";
    const response = await webhookPost(paymentRequest("payment-missing-sig"));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /ausente/i);
  } finally {
    restoreEnv(snap);
  }
});

test("setup: invalid signature is rejected when secret is configured", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test" });
    globalThis.__mockWebhookSecret = "test-setup-secret";
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await webhookPost(
      paymentRequest("payment-invalid-sig", {
        "x-signature": `ts=${timestamp},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        "x-request-id": "req-invalid-setup-1",
      }),
    );
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /invalida/i);
  } finally {
    restoreEnv(snap);
  }
});

test("setup: valid signature is processed and stays idempotent", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test" });
    const secret = "test-setup-secret";
    globalThis.__mockWebhookSecret = secret;
    const { getRpcCalls, futureEnd } = mockApprovedPayment();
    const paymentId = "payment-setup-valid";
    const requestId = "req-valid-setup-1";
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      "x-signature": `ts=${timestamp},v1=${sign(paymentId, requestId, timestamp, secret)}`,
      "x-request-id": requestId,
    };

    const first = await webhookPost(paymentRequest(paymentId, headers));
    assert.equal(first.status, 200);
    const firstJson = await first.json();
    assert.equal(firstJson.received, true);
    assert.equal(firstJson.processed, true);
    assert.equal(firstJson.already_processed, false);
    assert.equal(firstJson.current_period_end, futureEnd);

    const second = await webhookPost(paymentRequest(paymentId, headers));
    assert.equal(second.status, 200);
    const secondJson = await second.json();
    assert.equal(secondJson.received, true);
    assert.equal(secondJson.processed, true);
    assert.equal(secondJson.already_processed, true);
    assert.equal(getRpcCalls(), 2);
  } finally {
    restoreEnv(snap);
  }
});

test("setup: dev without secret processes through the explicit non-production bypass", async () => {
  const snap = snapshotEnv();
  try {
    applyEnv({ NODE_ENV: "test" });
    globalThis.__mockWebhookSecret = null;
    mockApprovedPayment();
    const response = await webhookPost(paymentRequest("payment-dev-bypass"));
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.received, true);
    assert.equal(json.processed, true);
  } finally {
    restoreEnv(snap);
  }
});
