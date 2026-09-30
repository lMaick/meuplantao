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
const __syncReversalsUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "mercadopago", "reversals.ts")).href;
const __syncObservabilityUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "observability", "index.ts")).href;

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-token";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __syncObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") {
      return { url: __syncTrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return { url: __syncPaymentsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/reversals") {
      return { url: __syncReversalsUrl, shortCircuit: true };
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

const { POST: syncRoute } = await import("../src/app/api/mercadopago/sync/route.ts");
const { paymentBelongsToUser } = await import("../src/lib/mercadopago/config.ts");
const { setLogSinkForTesting } = await import("../src/lib/observability/index.ts");

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
          { id: "1001", status: "approved", external_reference: testUserId, date_created: "2026-09-19T20:00:00Z", currency_id: "BRL", transaction_amount: 12.9, preference_id: "pref-sync-1001" },
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
    from: (table) => {
      if (table === "subscription_checkouts") {
        const createQuery = () => ({
          eq: () => createQuery(),
          is: () => createQuery(),
          order: () => createQuery(),
          limit: () => createQuery(),
          maybeSingle: async () => ({
            data: {
              id: "chk_mock_sync_1001",
              user_id: testUserId,
              plan_id: "pro_monthly",
              months: 1,
              validity_days: 30,
              amount: 12.9,
              amount_cents: 1290,
              price_cents: 1290,
              currency: "BRL",
              preference_id: "pref-sync-1001",
              completed_payment_id: null,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
            error: null,
          }),
        });
        return {
          select: () => createQuery(),
          update: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "chk_mock_sync_1001" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { status: "active", current_period_end: new Date(Date.now() + 30 * 86400000).toISOString() },
              error: null,
            }),
          }),
        }),
      };
    },
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
  // MAI-147: claim atômico da cotação vinculada via preference_id
  assert.equal(rpcCall.params.p_checkout_id, "chk_mock_sync_1001");
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
        { id: "old-100", status: "approved", external_reference: testUserId, date_created: pastDate, currency_id: "BRL", transaction_amount: 12.9, preference_id: "pref-sync-old" },
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
    from: (table) => {
      if (table === "subscription_checkouts") {
        const createQuery = () => ({
          eq: () => createQuery(),
          is: () => createQuery(),
          order: () => createQuery(),
          limit: () => createQuery(),
          maybeSingle: async () => ({
            data: {
              id: "chk_mock_sync_old",
              user_id: testUserId,
              plan_id: "pro_monthly",
              months: 1,
              validity_days: 30,
              amount: 12.9,
              amount_cents: 1290,
              price_cents: 1290,
              currency: "BRL",
              preference_id: "pref-sync-old",
              status: "completed",
              completed_payment_id: "old-100",
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
            error: null,
          }),
        });
        return {
          select: () => createQuery(),
          update: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { id: "chk_mock_sync_old" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { status: "active", current_period_end: pastDate },
              error: null,
            }),
          }),
        }),
      };
    },
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

test("sync MP search !ok: responde 502 temporario e registra captureSyncError com http_status 502", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  const capturedLogs = [];
  setLogSinkForTesting((entry) => capturedLogs.push(entry));

  globalThis.fetch = async () => new Response("Bad Gateway", { status: 502 });

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 502);
  const json = await response.json();
  assert.match(json.error, /consultar pagamentos/i);

  assert.equal(capturedLogs.length, 1);
  assert.equal(capturedLogs[0].route, "/api/mercadopago/sync");
  assert.equal(capturedLogs[0].http_status, 502);
  assert.equal(capturedLogs[0].alert_rule, "sync_5xx");
  assert.equal(capturedLogs[0].context?.search_stage, "user_payments_search");
  setLogSinkForTesting(null);
});

test("sync fallback search !ok: nao retorna falsamente 'nenhum pagamento' e responde 502 com captureSyncError com http_status 502", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  const capturedLogs = [];
  setLogSinkForTesting((entry) => capturedLogs.push(entry));

  let callCount = 0;
  globalThis.fetch = async (url) => {
    callCount++;
    if (callCount === 1) {
      // Primeira busca retorna lista vazia
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    // Segunda busca (fallback geral) falha com 500
    return new Response("Internal Error", { status: 500 });
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 502, "Fallback falhando deve retornar 502 e não falso 'nenhum pagamento'");
  const json = await response.json();
  assert.match(json.error, /consultar pagamentos/i);
  assert.equal(json.payment_found, undefined, "Não deve retornar payment_found: false em caso de falha de upstream");

  assert.equal(capturedLogs.length, 1);
  assert.equal(capturedLogs[0].route, "/api/mercadopago/sync");
  assert.equal(capturedLogs[0].http_status, 502);
  assert.equal(capturedLogs[0].alert_rule, "sync_5xx");
  assert.equal(capturedLogs[0].context?.search_stage, "fallback_payments_search");
  setLogSinkForTesting(null);
});

test("sync generic exception: responde 500 e registra captureSyncError com default http_status 500", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
  };

  const capturedLogs = [];
  setLogSinkForTesting((entry) => capturedLogs.push(entry));

  globalThis.fetch = async () => {
    throw new Error("Unexpected network blowup");
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 500);
  const json = await response.json();
  assert.match(json.error, /Nao foi possivel sincronizar/i);

  assert.equal(capturedLogs.length, 1);
  assert.equal(capturedLogs[0].route, "/api/mercadopago/sync");
  assert.equal(capturedLogs[0].http_status, 500);
  assert.equal(capturedLogs[0].alert_rule, "sync_5xx");
  assert.equal(capturedLogs[0].level, "error");
  setLogSinkForTesting(null);
});
