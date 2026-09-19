import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-token'; export const getMercadoPagoWebhookSecret = () => null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com';",
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

const { POST: syncRoute } = await import("../src/app/api/mercadopago/sync/route.ts");

const testUserId = "33333333-3333-4333-8333-333333333333";

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
  assert.deepEqual(await response.json(), { synced: true, status: "active" });

  assert.equal(
    calls[0].url,
    `https://api.mercadopago.test/v1/payments/search?external_reference=${testUserId}&sort=date_created&criteria=desc&limit=5`,
  );
  assert.deepEqual(calls[1], {
    row: { user_id: testUserId, status: "active" },
    options: { onConflict: "user_id" },
  });
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
