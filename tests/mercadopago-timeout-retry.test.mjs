import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

// MAI-144: deadline curto para simular lentidão sem estourar a suíte.
process.env.MERCADO_PAGO_TIMEOUT_MS = "50";

const __mpTimeoutFile = fileURLToPath(import.meta.url);
const __billingRateLimitUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "billing", "rate-limit.ts")).href;
const __trialUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "subscription", "trial.ts")).href;
const __paymentsUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "mercadopago", "payments.ts")).href;
const __reversalsUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "mercadopago", "reversals.ts")).href;
const __webhookUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "mercadopago", "webhook.ts")).href;
const __httpUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "mercadopago", "http.ts")).href;
const __observabilityUrl = pathToFileURL(path.join(path.dirname(__mpTimeoutFile), "..", "src", "lib", "observability", "index.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/billing/rate-limit") return { url: __billingRateLimitUrl, shortCircuit: true };
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __observabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: __trialUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: __paymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/reversals") return { url: __reversalsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: __webhookUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/http") return { url: __httpUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-test-token-timeout'; export const getMercadoPagoWebhookSecret = () => globalThis.__mockWebhookSecret ?? null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com'; export const paymentBelongsToUser = (p, userId) => { if (!userId || !p) return false; const rawRef = (p.external_reference || '').trim(); const [refUser] = rawRef ? rawRef.split('%23') : ['']; const metaUser = (p.metadata?.user_id || p.metadata?.userId || '').trim(); const hasRef = Boolean(refUser); const hasMeta = Boolean(metaUser); if (!hasRef && !hasMeta) return false; if (hasRef && hasMeta) return refUser === userId && metaUser === userId; if (hasRef) return refUser === userId; return metaUser === userId; }; export const isProductionEnvironment = () => false; export const isMissingWebhookSecretAllowed = () => true; export const getWebhookSetupState = () => ({ configured: false, failClosed: false }); export const LEGACY_IPN_DISABLED_CODE = 'legacy_ipn_disabled'; export const LEGACY_IPN_DISABLED_PUBLIC_ERROR = 'IPN legado desabilitado'; export const isLegacyIpnEnabled = () => true;",
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/supabase/server") {
      return {
        url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const {
  fetchMercadoPago,
  MercadoPagoTimeoutError,
  MercadoPagoNetworkError,
  isTransientMercadoPagoStatus,
  isDefinitiveMercadoPagoStatus,
  isTransientMercadoPagoFailure,
  isSafeToRetry,
  getTimeoutForOperation,
} = await import("../src/lib/mercadopago/http.ts");
const { POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { GET: ipnGet } = await import("../src/app/api/webhooks/mercadopago/ipn/route.ts");
const { GET: verifyGet } = await import("../src/app/api/mercadopago/verify/route.ts");
const { POST: checkoutPost } = await import("../src/app/api/mercadopago/checkout/route.ts");
const { setLogSinkForTesting } = await import("../src/lib/observability/index.ts");

const validUserId = "33333333-3333-4333-8333-333333333333";

/**
 * Simula provedor lento: rejeita ATIVAMENTE via DOMException no abort,
 * destravando o event loop imediatamente (CI Node 22) em vez de deixar
 * promise pendurada sem settlement.
 */
function mockSlowProvider() {
  globalThis.fetch = (_url, opts) =>
    new Promise((_resolve, reject) => {
      const signal = opts?.signal;
      const abortErr = () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      if (!signal) {
        abortErr();
        return;
      }
      if (signal.aborted) {
        abortErr();
        return;
      }
      signal.addEventListener("abort", abortErr, { once: true });
    });
}

/** Simula queda de rede (socket reset). */
function mockNetworkDrop() {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed: connect ECONNRESET");
  };
}

function checkoutRow() {
  return {
    id: "chk_timeout_mock",
    user_id: validUserId,
    plan_id: "meuplantao-pro-1",
    months: 1,
    validity_days: 30,
    amount: 12.9,
    amount_cents: 1290,
    price_cents: 1290,
    currency: "BRL",
    preference_id: "pref-timeout-1",
    completed_payment_id: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };
}

function checkoutLookupAdmin(extra = {}) {
  return {
    rpc: async () => ({ data: null, error: null }),
    from: (table) => {
      if (table === "subscription_payments_quarantine") {
        return { insert: async () => ({ error: null }) };
      }
      const q = () => ({
        eq: () => q(),
        maybeSingle: async () => ({ data: checkoutRow(), error: null }),
      });
      return { select: () => q(), update: () => ({ eq: () => ({}) }), ...extra };
    },
  };
}

// -------------------------------------------------------------
// 1. Timeout / abort em chamadas externas (MAI-144 §1)
// -------------------------------------------------------------
test("1. fetchMercadoPago aborta chamada lenta dentro do deadline (AbortSignal.timeout)", async () => {
  mockSlowProvider();
  const started = Date.now();
  await assert.rejects(
    () => fetchMercadoPago("/v1/payments/slow-1", { operation: "payments.get", method: "GET" }),
    (err) => {
      assert.ok(err instanceof MercadoPagoTimeoutError, "deve ser MercadoPagoTimeoutError");
      assert.equal(err.operation, "payments.get");
      return true;
    },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `deadline deve abortar rápido (levou ${elapsed}ms)`);
  assert.equal(getTimeoutForOperation("payments.get"), 50);
});

test("1b. Webhook com provedor lento responde 504 retentável SEM conceder Pro nem tocar o ledger", async () => {
  globalThis.__mockWebhookSecret = null;
  mockSlowProvider();
  const capturedLogs = [];
  setLogSinkForTesting((entry) => capturedLogs.push(entry));

  let rpcCalls = 0;
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalls++;
      return { data: null, error: null };
    },
    from: () => {
      throw new Error("ledger não deve ser tocado em timeout");
    },
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-slow-1" }, type: "payment" }),
  });
  const response = await webhookPost(request);
  assert.equal(response.status, 504, "timeout deve responder 504 para o provedor retentar");
  const json = await response.json();
  assert.match(json.error, /tempo esgotado/i);
  assert.equal(rpcCalls, 0, "nenhuma RPC financeira pode executar após timeout");

  assert.equal(capturedLogs.length, 1);
  assert.equal(capturedLogs[0].http_status, 504);
  assert.equal(capturedLogs[0].context?.failure_kind, "mercadopago_timeout");
  const logJson = JSON.stringify(capturedLogs[0]);
  assert.ok(!logJson.includes("mp-test-token-timeout"), "access token nunca vaza em log");
  setLogSinkForTesting(null);
});

test("1c. Checkout com provedor lento responde 504 SEM criar preferência duplicada (sem retry de POST)", async () => {
  mockSlowProvider();
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: validUserId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  globalThis.adminClient = {
    from: () => ({ insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) }),
  };
  const response = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
  assert.equal(response.status, 504, "timeout no POST deve responder 504 retentável pelo cliente");
  const json = await response.json();
  assert.match(json.error, /tempo esgotado|tente novamente/i);
});

test("1d. Verify com provedor lento responde 504 SEM processar pagamento", async () => {
  mockSlowProvider();
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: validUserId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  let rpcCalls = 0;
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalls++;
      return { data: null, error: null };
    },
  };
  const { NextRequest } = await import("next/server");
  const response = await verifyGet(
    new NextRequest("http://localhost/api/mercadopago/verify?payment_id=payment-slow-verify", { method: "GET" }),
  );
  assert.equal(response.status, 504);
  assert.equal(rpcCalls, 0, "timeout no verify nunca processa pagamento");
});

// -------------------------------------------------------------
// 2. Transitório vs definitivo (MAI-144 §2)
// -------------------------------------------------------------
test("2. Classificação transitório (timeout/503/504/rede) vs definitivo (400/401/404/422)", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientMercadoPagoStatus(status), true, `${status} é transitório`);
    assert.equal(isDefinitiveMercadoPagoStatus(status), false, `${status} não é definitivo`);
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isDefinitiveMercadoPagoStatus(status), true, `${status} é definitivo`);
    assert.equal(isTransientMercadoPagoStatus(status), false, `${status} não é transitório`);
  }
  assert.equal(isTransientMercadoPagoFailure(new MercadoPagoTimeoutError("payments.get", 50)), true);
  assert.equal(isTransientMercadoPagoFailure(new MercadoPagoNetworkError("payments.get")), true);
  assert.equal(isTransientMercadoPagoFailure(new TypeError("fetch failed: ECONNRESET")), true);
  assert.equal(isTransientMercadoPagoFailure(new Error("pagamento inválido")), false);
});

test("2b. Política de retry segura: GET idempotente pode retentar; POST nunca", () => {
  assert.equal(isSafeToRetry("payments.get", "GET"), true);
  assert.equal(isSafeToRetry("payments.search", "GET"), true);
  assert.equal(isSafeToRetry("checkout.create", "POST"), false, "POST não idempotente NUNCA repete");
  assert.equal(isSafeToRetry("payments.get", "POST"), false);
});

test("2c. Queda de rede no webhook responde 502 retentável SEM conceder Pro", async () => {
  globalThis.__mockWebhookSecret = null;
  mockNetworkDrop();
  let rpcCalls = 0;
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalls++;
      return { data: null, error: null };
    },
    from: () => {
      throw new Error("ledger não deve ser tocado em queda de rede");
    },
  };
  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-net-drop" }, type: "payment" }),
  });
  const response = await webhookPost(request);
  assert.equal(response.status, 502);
  assert.equal(rpcCalls, 0);
});

test("2d. Erro definitivo (422) do provedor responde 200 ignored SEM retry nem ledger", async () => {
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Unprocessable" }), { status: 422 });
  let rpcCalls = 0;
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalls++;
      return { data: null, error: null };
    },
  };
  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-def-422" }, type: "payment" }),
  });
  const response = await webhookPost(request);
  assert.equal(response.status, 200, "definitivo não gera retry (200 ignored)");
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.ignored, true);
  assert.equal(rpcCalls, 0);
});

// -------------------------------------------------------------
// 3. Repetição do webhook / idempotência (MAI-144 §3 + auditoria)
// -------------------------------------------------------------
test("3. Retry do webhook persiste concessão única no ledger (sem duplicar Pro)", async () => {
  globalThis.__mockWebhookSecret = null;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "approved",
        external_reference: validUserId,
        currency_id: "BRL",
        transaction_amount: 12.9,
        preference_id: "pref-timeout-1",
      }),
      { status: 200 },
    );

  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  // Modelo do ledger persistido (subscription_payments): a RPC atômica só
  // insere uma linha por payment_id; retries enxergam a linha existente.
  const ledger = [];
  let rpcCalls = 0;
  const base = checkoutLookupAdmin();
  globalThis.adminClient = {
    ...base,
    rpc: async (fn, params) => {
      assert.equal(fn, "process_mercadopago_subscription_payment");
      rpcCalls++;
      const existing = ledger.find((row) => row.payment_id === params.p_payment_id);
      if (existing) {
        return {
          data: {
            already_processed: true,
            current_period_end: existing.period_end,
            validity_days_added: 0,
            status: "active",
          },
          error: null,
        };
      }
      const row = {
        payment_id: params.p_payment_id,
        user_id: params.p_user_id,
        validity_days: params.p_validity_days,
        period_end: periodEnd,
      };
      ledger.push(row);
      return {
        data: {
          already_processed: false,
          current_period_end: periodEnd,
          validity_days_added: 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  const makeReq = () =>
    new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-idem-144" }, type: "payment" }),
    });

  const res1 = await webhookPost(makeReq());
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.processed, true);
  assert.equal(json1.already_processed, false);
  assert.equal(ledger.length, 1, "1ª entrega persiste exatamente 1 concessão no ledger");

  // Repetição legítima do provedor (retry após timeout/rede).
  const res2 = await webhookPost(makeReq());
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.processed, true);
  assert.equal(json2.already_processed, true, "retry não pode estender vigência de novo");
  assert.equal(json2.current_period_end, periodEnd, "vigência idêntica — sem duplicar Pro");
  assert.equal(rpcCalls, 2);
  assert.equal(ledger.length, 1, "ledger mantém UMA única linha após o retry (concessão única)");
  assert.equal(
    ledger.filter((row) => row.payment_id === "payment-idem-144").length,
    1,
    "payment_id aparece uma única vez no ledger",
  );
});

test("3b. Webhook 408 transitório responde 502 (nunca 200) e o retry processa sem perda", async () => {
  globalThis.__mockWebhookSecret = null;
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) return new Response(JSON.stringify({ message: "Request Timeout" }), { status: 408 });
    return new Response(
      JSON.stringify({
        status: "approved",
        external_reference: validUserId,
        currency_id: "BRL",
        transaction_amount: 12.9,
        preference_id: "pref-timeout-1",
      }),
      { status: 200 },
    );
  };

  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  const ledger = [];
  const base = checkoutLookupAdmin();
  globalThis.adminClient = {
    ...base,
    rpc: async (fn, params) => {
      const existing = ledger.find((row) => row.payment_id === params.p_payment_id);
      if (existing) {
        return {
          data: { already_processed: true, current_period_end: existing.period_end, validity_days_added: 0, status: "active" },
          error: null,
        };
      }
      ledger.push({ payment_id: params.p_payment_id, period_end: periodEnd });
      return {
        data: { already_processed: false, current_period_end: periodEnd, validity_days_added: 30, status: "active" },
        error: null,
      };
    },
  };

  const makeReq = () =>
    new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-408-retry" }, type: "payment" }),
    });

  const res408 = await webhookPost(makeReq());
  assert.equal(res408.status, 502, "408 transitório deve responder 502 para o provedor retentar");
  assert.equal(ledger.length, 0, "resposta transitória não persiste nada no ledger");

  const resRetry = await webhookPost(makeReq());
  assert.equal(resRetry.status, 200);
  const jsonRetry = await resRetry.json();
  assert.equal(jsonRetry.processed, true, "retry legítimo processa sem perda do pagamento");
  assert.equal(ledger.length, 1, "pagamento registrado exatamente 1 vez após o retry");
});

test("4. Checkout diferencia transitório (502/429 retentável) de definitivo (422 claro)", async () => {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: validUserId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  globalThis.adminClient = {
    from: () => ({ insert: async () => ({ error: null }), update: () => ({ eq: async () => ({ error: null }) }) }),
  };
  const checkoutReq = () => new Request("http://localhost/api/mercadopago/checkout", { method: "POST" });

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Bad Gateway" }), { status: 503 });
  const resTransient = await checkoutPost(checkoutReq());
  assert.equal(resTransient.status, 502, "5xx do provedor => 502 retentável");
  const jsonTransient = await resTransient.json();
  assert.match(jsonTransient.error, /tente novamente/i);
  assert.equal(jsonTransient.retryable, true, "payload transitório sinaliza retryable:true");

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 });
  const resRateLimited = await checkoutPost(checkoutReq());
  assert.equal(resRateLimited.status, 429, "429 do provedor => 429 para o cliente recuar");
  assert.equal((await resRateLimited.json()).retryable, true);

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Invalid item" }), { status: 400 });
  const resDefinitive = await checkoutPost(checkoutReq());
  assert.equal(resDefinitive.status, 422, "4xx definitivo => 422 claro, sem retry cego");
  const jsonDefinitive = await resDefinitive.json();
  assert.match(jsonDefinitive.error, /rejeitou/i);
  assert.equal(jsonDefinitive.retryable, false, "payload definitivo sinaliza retryable:false");
});

test("4b. IPN 408/425 transitório responde 502 (nunca 200) e preserva o retry", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Request Timeout" }), { status: 408 });
  let rpcCalls = 0;
  globalThis.adminClient = {
    rpc: async () => {
      rpcCalls++;
      return { data: null, error: null };
    },
  };
  const res408 = await ipnGet(
    new Request("http://localhost/api/webhooks/mercadopago/ipn?id=ipn-408-direct&topic=payment", { method: "GET" }),
  );
  assert.equal(res408.status, 502, "IPN 408 transitório deve responder 502 para o provedor retentar");
  assert.equal(rpcCalls, 0, "resposta transitória não toca o ledger");

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Too Early" }), { status: 425 });
  const res425 = await ipnGet(
    new Request("http://localhost/api/webhooks/mercadopago/ipn?id=ipn-425-direct&topic=payment", { method: "GET" }),
  );
  assert.equal(res425.status, 502, "IPN 425 transitório deve responder 502 para o provedor retentar");
  assert.equal(rpcCalls, 0);
});
