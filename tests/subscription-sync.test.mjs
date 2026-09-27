import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __syncTestFile = fileURLToPath(import.meta.url);
const __syncDirname = path.dirname(__syncTestFile);
const __syncTrialUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "subscription", "trial.ts")).href;
const __syncConfigUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "mercadopago", "config.ts")).href;
const __syncPaymentsUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "mercadopago", "payments.ts")).href;

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-token";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/subscription/trial") {
      return { url: __syncTrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return { url: __syncPaymentsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: __syncConfigUrl,
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") {
      return {
        url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: syncRoute, paymentBelongsToUser } = await import("../src/app/api/mercadopago/sync/route.ts");

const testUserId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";

function createMockRequest() {
  return new Request("http://localhost/api/mercadopago/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

test("sync route requires authenticated user (401)", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: null }, error: new Error("No session") }) },
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.equal(json.error, "Autenticacao obrigatoria");
});

test("sync route activates subscription when approved payment is found", async () => {
  const calls = [];
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        results: [
          { id: "1001", status: "approved", external_reference: testUserId, date_created: "2026-09-19T20:00:00Z" },
        ],
      }),
      { status: 200 },
    );
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
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { status: "active", current_period_end: new Date(Date.now() + 30 * 86400000).toISOString() },
            error: null,
          }),
        }),
      }),
    }),
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 200);
  const syncedJson = await response.json();
  assert.equal(syncedJson.synced, true);
  assert.equal(syncedJson.status, "active");
  assert.ok(syncedJson.current_period_end, "MAI-126: sync deve retornar current_period_end cumulativo");

  assert.equal(
    calls[0].url,
    `https://api.mercadopago.com/v1/payments/search?external_reference=${testUserId}&sort=date_created&criteria=desc&limit=50`,
  );
  const rpcCall = calls.find((c) => c && c.fn === "process_mercadopago_subscription_payment");
  assert.ok(rpcCall, "sync deve chamar a RPC atômica");
  assert.equal(rpcCall.params.p_user_id, testUserId);
  assert.equal(rpcCall.params.p_payment_id, "1001");
});

test("security: sync route NEVER activates payments without external_reference or belonging to another user", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  // Mock search returning payments from other users or missing reference
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        results: [
          { id: "9999", status: "approved", external_reference: otherUserId, date_created: "2026-09-19T20:00:00Z" },
          { id: "8888", status: "approved", external_reference: "", date_created: "2026-09-19T20:00:00Z" },
          { id: "7777", status: "approved", external_reference: null, metadata: {}, date_created: "2026-09-19T20:00:00Z" },
        ],
      }),
      { status: 200 },
    );
  };

  let rpcCalled = false;
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.synced, false);
  assert.equal(json.status, "trialing");
  assert.equal(rpcCalled, false, "Nao deve chamar RPC para pagamentos de terceiros ou sem ref");
});

test("paymentBelongsToUser correctly matches package refs and metadata", () => {
  assert.equal(paymentBelongsToUser({ external_reference: testUserId }, testUserId), true);
  assert.equal(paymentBelongsToUser({ external_reference: `${testUserId}#6` }, testUserId), true);
  assert.equal(paymentBelongsToUser({ external_reference: `${testUserId}#12` }, testUserId), true);
  assert.equal(paymentBelongsToUser({ metadata: { user_id: testUserId } }, testUserId), true);
  assert.equal(paymentBelongsToUser({ metadata: { userId: testUserId } }, testUserId), true);

  assert.equal(paymentBelongsToUser({ external_reference: otherUserId }, testUserId), false);
  assert.equal(paymentBelongsToUser({ external_reference: "" }, testUserId), false);
  assert.equal(paymentBelongsToUser({}, testUserId), false);
  assert.equal(paymentBelongsToUser({ external_reference: "generic-payment" }, testUserId), false);
});

test("sync route returns synced: false and status: trialing when no approved payment found", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        results: [
          { id: "1002", status: "pending", external_reference: testUserId },
        ],
      }),
      { status: 200 },
    );
  };

  globalThis.adminClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.synced, false);
  assert.equal(json.payment_found, false);
  assert.equal(json.payment_processed_now, false);
  assert.equal(json.already_processed, false);
  assert.equal(json.subscription_active, false);
  assert.equal(json.subscription_status, "trialing");
  assert.equal(json.status, "trialing");
});

test("sync route returns 502 if Mercado Pago API fails", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ message: "Internal error" }), { status: 500 });
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 502);
  const json = await response.json();
  assert.equal(json.error, "Nao foi possivel consultar pagamentos no Mercado Pago");
});

test("sync route returns status: expired when current_period_end has passed even if DB status is active", async () => {
  const pastDate = new Date(Date.now() - 86400000).toISOString();
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      results: [
        { id: "old-100", status: "approved", external_reference: testUserId, date_created: pastDate },
      ],
    }),
    { status: 200 },
  );

  globalThis.adminClient = {
    rpc: async () => ({
      data: {
        already_processed: true,
        current_period_end: pastDate,
        validity_days_added: 0,
        status: "expired",
      },
      error: null,
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { status: "active", current_period_end: pastDate },
            error: null,
          }),
        }),
      }),
    }),
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.synced, true);
  assert.equal(json.payment_found, true);
  assert.equal(json.already_processed, true);
  assert.equal(json.payment_processed_now, false);
  assert.equal(json.subscription_active, false, "Caso 2: subscription_active deve ser false quando vigencia expirou");
  assert.equal(json.subscription_status, "expired");
  assert.equal(json.status, "expired");
  assert.equal(json.current_period_end, pastDate);
});
