import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __syncTestFile = fileURLToPath(import.meta.url);
const __syncDirname = path.dirname(__syncTestFile);
const __syncTrialUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "subscription", "trial.ts")).href;
const __syncConfigUrl = pathToFileURL(path.join(__syncDirname, "..", "src", "lib", "mercadopago", "config.ts")).href;

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-token";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/subscription/trial") {
      return { url: __syncTrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: __syncConfigUrl,
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/stripe/supabase") {
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
    from: () => ({
      upsert: async (row, options) => {
        calls.push({ row, options });
        return { error: null };
      },
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
  assert.equal(calls[1].row.user_id, testUserId);
  assert.equal(calls[1].row.status, "active");
  assert.equal(calls[1].options.onConflict, "user_id");
  assert.ok(calls[1].row.current_period_end, "MAI-126: upsert deve gravar current_period_end");
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

  let upsertCalled = false;
  globalThis.adminClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      upsert: async () => {
        upsertCalled = true;
        return { error: null };
      },
    }),
  };

  const response = await syncRoute(createMockRequest());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.synced, false);
  assert.equal(json.status, "trialing");
  assert.equal(upsertCalled, false, "Nao deve fazer upsert de assinatura para pagamentos de terceiros ou sem ref");
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
  assert.deepEqual(await response.json(), { synced: false, status: "trialing" });
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
