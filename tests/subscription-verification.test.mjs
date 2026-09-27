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
  assert.equal(json.payment_found, true);
  assert.equal(json.payment_processed_now, true);
  assert.equal(json.already_processed, false);
  assert.equal(json.subscription_active, true);
  assert.equal(json.subscription_status, "active");
  assert.equal(json.activated, true);
  assert.equal(json.status, "active");
  assert.ok(json.current_period_end);
  assert.equal(calls[0], "https://api.mercadopago.com/v1/payments/payment-123");
  const rpcCall = calls.find((c) => c && c.fn === "process_mercadopago_subscription_payment");
  assert.ok(rpcCall);
  assert.equal(rpcCall.params.p_user_id, userId);
  assert.equal(rpcCall.params.p_payment_id, "payment-123");
});

test("Caso 1: webhook processes payment first; verify returns already_processed=true but subscription_active=true", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "approved", external_reference: userId }), { status: 200 });

  const futureDate = new Date(Date.now() + 30 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async () => ({
      data: {
        already_processed: true,
        current_period_end: futureDate,
        validity_days_added: 0,
        status: "active",
      },
      error: null,
    }),
  };

  const response = await verifyPayment(verifyRequest("payment_id=already-processed-payment"));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.verified, true);
  assert.equal(json.payment_found, true);
  assert.equal(json.already_processed, true, "already_processed deve ser true quando webhook ja processou");
  assert.equal(json.payment_processed_now, false, "payment_processed_now deve ser false");
  assert.equal(json.subscription_active, true, "subscription_active DEVE ser true porque a vigencia e futura");
  assert.equal(json.subscription_status, "active", "subscription_status deve ser active");
  assert.equal(json.activated, true, "activated deve ser true para manter o frontend em estado de sucesso");
  assert.equal(json.current_period_end, futureDate);
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
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "pending", external_reference: userId }), { status: 200 });
  globalThis.adminClient = {
    rpc: async () => { throw new Error("must not call rpc"); },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };

  const response = await verifyPayment(verifyRequest("payment_id=pending-789"));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.verified, true);
  assert.equal(json.payment_found, true);
  assert.equal(json.payment_processed_now, false);
  assert.equal(json.already_processed, false);
  assert.equal(json.subscription_active, false);
  assert.equal(json.activated, false);
  assert.equal(json.status, "pending");
  assert.equal(json.payment_status, "pending");
});

test("renewal with pending payment when user already has active Pro subscription returns subscription_active=true and payment_status=pending", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "pending", external_reference: userId }), { status: 200 });
  const futureDate = new Date(Date.now() + 15 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async () => { throw new Error("must not call rpc"); },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { status: "active", current_period_end: futureDate },
            error: null,
          }),
        }),
      }),
    }),
  };

  const response = await verifyPayment(verifyRequest("payment_id=renewal-pending-123"));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.verified, true);
  assert.equal(json.payment_found, true);
  assert.equal(json.payment_processed_now, false);
  assert.equal(json.already_processed, false);
  assert.equal(json.subscription_active, true, "deve manter subscription_active true pois periodo ainda e valido");
  assert.equal(json.payment_status, "pending", "payment_status deve ser pending");
  assert.equal(json.current_period_end, futureDate);
});

test("security: pending payment belonging to another user returns 403 without data leakage", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  const userB = "22222222-2222-4222-8222-222222222222";
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "pending",
    external_reference: userB,
    transaction_amount: 99.90,
  }), { status: 200 });
  globalThis.adminClient = {
    rpc: async () => { throw new Error("must not call rpc"); },
    from: () => { throw new Error("must not query subscriptions table"); },
  };

  const response = await verifyPayment(verifyRequest("payment_id=pending-belonging-to-user-b"));
  assert.equal(response.status, 403);
  const json = await response.json();
  assert.deepEqual(json, { error: "Pagamento nao pertence a esta conta" });
  assert.equal(json.payment_status, undefined, "Nao deve vazar payment_status");
  assert.equal(json.payment_found, undefined, "Nao deve vazar payment_found");
  assert.equal(json.subscription_active, undefined, "Nao deve vazar subscription_active");
  assert.equal(json.verified, undefined, "Nao deve vazar verified");
});

test("security: rejected payment belonging to another user returns 403 without data leakage", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  const userB = "22222222-2222-4222-8222-222222222222";
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "rejected",
    external_reference: userB,
    transaction_amount: 149.90,
  }), { status: 200 });
  globalThis.adminClient = {
    rpc: async () => { throw new Error("must not call rpc"); },
    from: () => { throw new Error("must not query subscriptions table"); },
  };

  const response = await verifyPayment(verifyRequest("payment_id=rejected-belonging-to-user-b"));
  assert.equal(response.status, 403);
  const json = await response.json();
  assert.deepEqual(json, { error: "Pagamento nao pertence a esta conta" });
  assert.equal(json.payment_status, undefined, "Nao deve vazar payment_status");
  assert.equal(json.payment_found, undefined, "Nao deve vazar payment_found");
  assert.equal(json.subscription_active, undefined, "Nao deve vazar subscription_active");
  assert.equal(json.verified, undefined, "Nao deve vazar verified");
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
