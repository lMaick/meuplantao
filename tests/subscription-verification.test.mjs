import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "config.ts")).href;
const paymentsUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "payments.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: configUrl,
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return {
        url: paymentsUrl,
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

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-token";

const { GET: verifyPayment } = await import("../src/app/api/mercadopago/verify/route.ts");
const userId = "11111111-1111-4111-8111-111111111111";

function verifyRequest(query) {
  return {
    nextUrl: new URL(`http://localhost/api/mercadopago/verify?${query}`),
    cookies: { getAll: () => [] },
  };
}

function authenticatedClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  };
}

test("approved payment matching the authenticated user activates the subscription", async () => {
  const calls = [];
  globalThis.authenticatedClient = authenticatedClient();
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

  const response = await verifyPayment(verifyRequest("payment_id=payment-123"));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.verified, true);
  assert.equal(json.activated, true);
  assert.equal(json.status, "active");
  assert.ok(json.current_period_end);
  assert.equal(calls[0], "https://api.mercadopago.com/v1/payments/payment-123");
  const rpcCall = calls.find((c) => c && c.fn === "process_mercadopago_subscription_payment");
  assert.ok(rpcCall);
  assert.equal(rpcCall.params.p_user_id, userId);
  assert.equal(rpcCall.params.p_payment_id, "payment-123");
});

test("collection_id is accepted and a payment belonging to another user is rejected", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "approved", external_reference: "22222222-2222-4222-8222-222222222222" }), { status: 200 });
  globalThis.adminClient = { rpc: async () => { throw new Error("must not call rpc"); } };

  const response = await verifyPayment(verifyRequest("collection_id=collection-456"));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Pagamento nao pertence a esta conta" });
});

test("non-approved payment is reported without changing the subscription", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "pending" }), { status: 200 });
  globalThis.adminClient = { rpc: async () => { throw new Error("must not call rpc"); } };

  const response = await verifyPayment(verifyRequest("payment_id=pending-789"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true, activated: false, status: "pending" });
});

test("subscription hook reads the RLS-protected row and subscribes to changes", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/lib/subscription/use-subscription.ts"), "utf8");
  assert.match(source, /from\("subscriptions"\)/);
  assert.match(source, /select\(.*status.*\)/);
  assert.match(source, /current_period_end/);
  assert.match(source, /eq\("user_id", data\.user\.id\)/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /filter: `user_id=eq\.\$\{userId\}`/);
});
