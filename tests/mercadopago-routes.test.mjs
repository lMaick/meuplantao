import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __mpRoutesFile = fileURLToPath(import.meta.url);
const __billingRateLimitUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "billing", "rate-limit.ts")).href;
const __mpTrialUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "subscription", "trial.ts")).href;
const __mpPaymentsUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "mercadopago", "payments.ts")).href;
const __mpReversalsUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "mercadopago", "reversals.ts")).href;
const __mpWebhookUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "mercadopago", "webhook.ts")).href;
const __mpObservabilityUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "observability", "index.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/billing/rate-limit") return { url: __billingRateLimitUrl, shortCircuit: true };
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __mpObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") {
      return { url: __mpTrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return { url: __mpPaymentsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/reversals") {
      return { url: __mpReversalsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/webhook") {
      return { url: __mpWebhookUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") return { url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-token'; export const getMercadoPagoWebhookSecret = () => null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com'; export const isProductionEnvironment = () => process.env.VERCEL_ENV?.trim() === 'production' || process.env.NODE_ENV?.trim() === 'production'; export const isMissingWebhookSecretAllowed = () => { if (isProductionEnvironment()) return false; const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase(); return raw !== 'false' && raw !== '0' && raw !== 'no'; }; export const getWebhookSetupState = () => ({ configured: false, failClosed: !isMissingWebhookSecretAllowed() });", shortCircuit: true };
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") return { url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: checkout } = await import("../src/app/api/mercadopago/checkout/route.ts");
const { POST: webhook } = await import("../src/app/api/webhooks/mercadopago/route.ts");

const userId = "11111111-1111-4111-8111-111111111111";

function checkoutRequest() {
  return new Request("http://localhost/api/mercadopago/checkout", { method: "POST" });
}

function authenticatedClient(subscription = null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: subscription, error: null }) }) }) }),
  };
}

test("checkout creates a Mercado Pago preference for the authenticated user", async () => {
  const calls = [];
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: "pref-route-1", init_point: "https://www.mercadopago.com/checkout/v1" }), { status: 201 });
  };

  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { init_point: "https://www.mercadopago.com/checkout/v1" });
  assert.equal(calls[0].url, "https://api.mercadopago.test/checkout/preferences");
  assert.equal(calls[0].options.headers.Authorization, "Bearer mp-token");
  assert.equal(calls[0].body.items[0].unit_price, 12.9);
  // MAI-147: vínculo verificável cotação <-> preferência (user#months#checkoutId)
  assert.match(calls[0].body.external_reference, new RegExp(`^${userId}#1#[0-9a-f-]{36}$`));
  const refCheckoutId = calls[0].body.external_reference.split("#")[2];
  assert.equal(calls[0].body.metadata.checkout_id, refCheckoutId);
  assert.equal(calls[0].body.back_urls.success, "https://app.example.com/configuracoes?payment=success");
});

test("checkout allows active users to extend/renew their subscription without 409", async () => {
  const calls = [];
  globalThis.authenticatedClient = authenticatedClient({ status: "active", current_period_end: "2026-12-01T00:00:00Z" });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: "pref-route-renew", init_point: "https://www.mercadopago.com/checkout/renew" }), { status: 201 });
  };

  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { init_point: "https://www.mercadopago.com/checkout/renew" });
  assert.equal(calls[0].body.metadata.is_renewal, true);
});

test("webhook ignores non-payment notifications", async () => {
  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body: JSON.stringify({ type: "merchant_order", data: { id: "order-1" } }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, ignored: true });
});

test("approved payment activates the user's subscription", async () => {
  const calls = [];
  // MAI-147: pagamento carrega vínculo verificável (preference_id) com a cotação.
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({
      status: "approved",
      external_reference: userId,
      currency_id: "BRL",
      transaction_amount: 12.9,
      preference_id: "pref-route-active-1",
    }), { status: 200 });
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
    from: () => {
      const createQuery = () => ({
        eq: () => createQuery(),
        is: () => createQuery(),
        order: () => createQuery(),
        limit: () => createQuery(),
        maybeSingle: async () => ({
          data: {
            id: "chk_mock_route_1",
            user_id: userId,
            plan_id: "pro_monthly",
            months: 1,
            validity_days: 30,
            amount: 12.9,
            amount_cents: 1290,
            price_cents: 1290,
            currency: "BRL",
            preference_id: "pref-route-active-1",
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
                maybeSingle: async () => ({ data: { id: "chk_mock_route_1" }, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-1" } }),
  }));
  const webhookJson = await response.json();
  assert.equal(webhookJson.received, true);
  assert.equal(webhookJson.processed, true);
  assert.ok(webhookJson.current_period_end, "MAI-126: webhook deve retornar current_period_end");
  assert.equal(calls[0], "https://api.mercadopago.test/v1/payments/payment-1");
  const rpcCall = calls.find((c) => c && c.fn === "process_mercadopago_subscription_payment");
  assert.ok(rpcCall, "webhook deve chamar a RPC atômica process_mercadopago_subscription_payment");
  assert.equal(rpcCall.params.p_user_id, userId);
  assert.equal(rpcCall.params.p_payment_id, "payment-1");
  // MAI-147: claim atômico da cotação na mesma transação da vigência
  assert.equal(rpcCall.params.p_checkout_id, "chk_mock_route_1");
});

test("MAI-147: checkout sem preference_id falha fechado (sem init_point sem lastro)", async () => {
  globalThis.authenticatedClient = authenticatedClient();
  globalThis.adminClient = undefined;
  globalThis.fetch = async () => {
    // Mercado Pago não retornou ID da preferência: vínculo impossível
    return new Response(JSON.stringify({ init_point: "https://www.mercadopago.com/checkout/orphan" }), { status: 201 });
  };

  const response = await checkout(checkoutRequest());
  assert.equal(response.status, 500);
  const json = await response.json();
  assert.match(json.error, /vincular/i);
});

test("MAI-147: pagamento aprovado sem vínculo verificável vai para quarentena (nunca adivinha checkout)", async () => {  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      status: "approved",
      external_reference: userId,
      currency_id: "BRL",
      transaction_amount: 12.9,
    }), { status: 200 });
  };
  const quarantined = [];
  globalThis.adminClient = {
    rpc: async () => {
      throw new Error("RPC não deve ser chamada sem vínculo verificável");
    },
    from: (table) => {
      if (table === "subscription_payments_quarantine") {
        return { insert: async (row) => { quarantined.push(row); return { error: null }; } };
      }
      const createQuery = () => ({
        eq: () => createQuery(),
        is: () => createQuery(),
        order: () => createQuery(),
        limit: () => createQuery(),
        maybeSingle: async () => ({ data: null, error: null }),
      });
      return { select: () => createQuery(), update: () => ({ eq: () => ({}) }) };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-nolink" } }),
  }));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.quarantined, true);
  assert.equal(json.reason, "unlinked_payment_requires_review");
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0].reason, "unlinked_payment_requires_review");
});

test("MAI-147: disputa perdida pela mesma cotação (23505) vai para quarentena sem retry", async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      status: "approved",
      external_reference: userId,
      currency_id: "BRL",
      transaction_amount: 12.9,
      preference_id: "pref-route-race-1",
    }), { status: 200 });
  };
  const quarantined = [];
  globalThis.adminClient = {
    rpc: async (fn) => {
      assert.equal(fn, "process_mercadopago_subscription_payment");
      const failure = new Error("Falha no processamento atomico do pagamento");
      failure.code = "23505";
      failure.cause = { code: "23505", message: "Cotacao ja consumida por outro pagamento" };
      throw failure;
    },
    from: (table) => {
      if (table === "subscription_checkouts") {
        const createQuery = () => ({
          eq: () => createQuery(),
          maybeSingle: async () => ({
            data: {
              id: "chk_mock_route_race",
              user_id: userId,
              plan_id: "pro_monthly",
              months: 1,
              validity_days: 30,
              amount: 12.9,
              amount_cents: 1290,
              currency: "BRL",
              preference_id: "pref-route-race-1",
              completed_payment_id: null,
              expires_at: new Date(Date.now() + 86400000).toISOString(),
            },
            error: null,
          }),
        });
        return { select: () => createQuery(), update: () => ({ eq: () => ({}) }) };
      }
      if (table === "subscription_payments_quarantine") {
        return { insert: async (row) => { quarantined.push(row); return { error: null }; } };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-race-loser" } }),
  }));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.quarantined, true);
  assert.equal(json.reason, "checkout_already_completed");
  assert.equal(quarantined.length, 1);
});

test("MAI-136: refunded payment reconciles reversal without deleting ledger", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ status: "refunded", external_reference: userId }), { status: 200 });
  };
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      calls.push({ fn, params });
      assert.equal(fn, "reconcile_mercadopago_reversal");
      return {
        data: {
          reversed: true,
          already_reversed: false,
          not_found: false,
          ownership_mismatch: false,
          contributed: true,
          current_period_end: new Date().toISOString(),
          status: "expired",
          active_payments: 0,
          validity_days_removed: 30,
        },
        error: null,
      };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-refund-1" } }),
  }));
  const webhookJson = await response.json();
  assert.equal(response.status, 200);
  assert.equal(webhookJson.received, true);
  assert.equal(webhookJson.reversed, true);
  assert.equal(webhookJson.status, "expired");
  const rpcCall = calls.find((c) => c && c.fn === "reconcile_mercadopago_reversal");
  assert.ok(rpcCall, "webhook deve chamar reconcile_mercadopago_reversal para refunded");
  assert.equal(rpcCall.params.p_payment_id, "payment-refund-1");
  assert.equal(rpcCall.params.p_reversal_status, "refunded");
});

test("MAI-136: in_mediation signals human review without revoking", async () => {
  let rpcCalled = false;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ status: "in_mediation", external_reference: userId }), { status: 200 });
  };
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalled = true;
      return { data: {}, error: null };
    },
  };

  const response = await webhook(new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "payment-dispute-1" } }),
  }));
  const webhookJson = await response.json();
  assert.equal(response.status, 200);
  assert.equal(webhookJson.needs_review, true);
  assert.equal(rpcCalled, false, "disputa nao deve tocar o banco automaticamente");
});
