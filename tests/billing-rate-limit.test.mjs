import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

// MAI-138 — regressão de rate limit / cooldown distribuído de billing.
// O limitador é opt-in fora de produção (BILLING_RATE_LIMIT_ENABLED=true)
// para não interferir na suíte legada; em produção é ligado por padrão.

process.env.BILLING_RATE_LIMIT_ENABLED = "true";
delete process.env.BILLING_RATE_LIMIT_DISABLED;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const __rlFile = fileURLToPath(import.meta.url);
const __rlDir = path.dirname(__rlFile);
const fileUrl = (p) => pathToFileURL(path.join(__rlDir, "..", p)).href;
const __rlTrialUrl = fileUrl("src/lib/subscription/trial.ts");
const __rlPaymentsUrl = fileUrl("src/lib/mercadopago/payments.ts");
const __rlWebhookUrl = fileUrl("src/lib/mercadopago/webhook.ts");
const __rlObservabilityUrl = fileUrl("src/lib/observability/index.ts");
const __rlRateLimitUrl = fileUrl("src/lib/billing/rate-limit.ts");
const __rlReversalsUrl = fileUrl("src/lib/mercadopago/reversals.ts");
const __rlHttpUrl = fileUrl("src/lib/mercadopago/http.ts");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __rlObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: __rlTrialUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: __rlPaymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: __rlWebhookUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/reversals") return { url: __rlReversalsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/http") return { url: __rlHttpUrl, shortCircuit: true };
    if (specifier === "@/lib/billing/rate-limit") return { url: __rlRateLimitUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-test-token'; export const getMercadoPagoWebhookSecret = () => globalThis.__mockWebhookSecret ?? null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com'; export const isProductionEnvironment = () => process.env.VERCEL_ENV?.trim() === 'production' || process.env.NODE_ENV?.trim() === 'production'; export const isMissingWebhookSecretAllowed = () => { if (isProductionEnvironment()) return false; const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase(); return raw !== 'false' && raw !== '0' && raw !== 'no'; }; export const getWebhookSetupState = () => { if (globalThis.__mockWebhookSecret) return { configured: true, failClosed: false }; return { configured: false, failClosed: !isMissingWebhookSecretAllowed() }; }; export const LEGACY_IPN_DISABLED_CODE = 'legacy_ipn_disabled'; export const LEGACY_IPN_DISABLED_PUBLIC_ERROR = 'IPN legado desabilitado'; export const isLegacyIpnEnabled = () => { if (globalThis.__mockLegacyIpnEnabled !== undefined && globalThis.__mockLegacyIpnEnabled !== null) return globalThis.__mockLegacyIpnEnabled; const raw = process.env.MERCADO_PAGO_ENABLE_LEGACY_IPN?.trim().toLowerCase(); if (raw === 'true' || raw === '1' || raw === 'yes') return true; if (raw === 'false' || raw === '0' || raw === 'no') return false; return !isProductionEnvironment(); }; export const paymentBelongsToUser = (p, userId) => { if (!userId || !p) return false; const rawRef = (p.external_reference || '').trim(); const [paymentUserId] = rawRef ? rawRef.split(String.fromCharCode(35)) : ['']; const metadataUserId = (p.metadata?.user_id || p.metadata?.userId || '').trim(); if (!paymentUserId && !metadataUserId) return false; if (paymentUserId && metadataUserId) return paymentUserId === userId && metadataUserId === userId; return (paymentUserId || metadataUserId) === userId; };",
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

const { POST: checkoutPost } = await import("../src/app/api/mercadopago/checkout/route.ts");
const { POST: syncPost } = await import("../src/app/api/mercadopago/sync/route.ts");
const { GET: verifyGet } = await import("../src/app/api/mercadopago/verify/route.ts");
const { POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { GET: ipnGet, POST: ipnPost } = await import("../src/app/api/webhooks/mercadopago/ipn/route.ts");
const {
  BILLING_LIMITS,
  MemoryRateLimitStore,
  SupabaseRateLimitStore,
  UpstashRateLimitStore,
  buildBillingRateLimitedResponse,
  checkBillingCooldownAndMark,
  checkBillingLimit,
  clearRateLimitStoreForTesting,
  getBillingBodySizeOk,
  isBillingRateLimitEnabled,
  isValidBillingPaymentId,
  releaseBillingCooldown,
  resetBillingRateLimitsForTesting,
  resolveSupabaseStoreIfConfigured,
  setRateLimitStoreForTesting,
} = await import("../src/lib/billing/rate-limit.ts");
const { setLogSinkForTesting } = await import("../src/lib/observability/index.ts");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHECKOUT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function validApprovedPayment(userId, paymentId = "mp-valid-payment") {
  globalThis.__mockPaymentUserId = userId;
  return {
    id: paymentId,
    status: "approved",
    external_reference: `${userId}#1#${CHECKOUT_ID}`,
    currency_id: "BRL",
    transaction_amount: 12.9,
    metadata: { user_id: userId, months: 1, checkout_id: CHECKOUT_ID },
  };
}

// Prova de persistência simulada: payment ids já gravados em subscription_payments.
const processedPayments = new Set();

function useFreshStore() {
  setRateLimitStoreForTesting(new MemoryRateLimitStore());
  resetBillingRateLimitsForTesting();
  processedPayments.clear();
  globalThis.__mockWebhookSecret = null;
  globalThis.__mockLegacyIpnEnabled = null;
  globalThis.__mockPaymentUserId = null;
}

function authenticatedAs(userId) {
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "user@example.com" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
}

function approvedPaymentRpc() {
  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      if (params?.p_payment_id) processedPayments.add(String(params.p_payment_id));
      return {
        data: { already_processed: false, current_period_end: futureEnd, validity_days_added: 30, status: "active" },
        error: null,
      };
    },
    from: (table) => ({
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            if (table === "subscription_payments") {
              return processedPayments.has(String(val))
                ? { data: { mercadopago_payment_id: String(val) }, error: null }
                : { data: null, error: null };
            }
            if (table === "subscription_checkouts") {
              return {
                data: {
                  id: CHECKOUT_ID,
                  user_id: globalThis.__mockPaymentUserId || USER_A,
                  plan_id: "meuplantao-pro-1",
                  months: 1,
                  validity_days: 30,
                  amount: 12.9,
                  amount_cents: 1290,
                  currency: "BRL",
                  status: "pending",
                  completed_payment_id: null,
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  catalog_version: "2026-v1",
                },
                error: null,
              };
            }
            return { data: { status: "active", current_period_end: futureEnd }, error: null };
          },
        }),
      }),
      update: () => ({ eq: () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  };
  return futureEnd;
}

function mockMpApproved(externalReference, counter) {
  globalThis.fetch = async (url) => {
    counter.calls.push(String(url));
    return new Response(JSON.stringify(validApprovedPayment(externalReference)), { status: 200 });
  };
}

// ---------------------------------------------------------------------------
// 0. Habilitação do limitador
// ---------------------------------------------------------------------------

test("0. limitador: produção ON por padrão, dev/teste opt-in, kill-switch global", async () => {
  const saved = {
    enabled: process.env.BILLING_RATE_LIMIT_ENABLED,
    disabled: process.env.BILLING_RATE_LIMIT_DISABLED,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  };
  try {
    delete process.env.BILLING_RATE_LIMIT_ENABLED;
    delete process.env.BILLING_RATE_LIMIT_DISABLED;
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL_ENV;
    assert.equal(isBillingRateLimitEnabled(), false);

    process.env.BILLING_RATE_LIMIT_ENABLED = "true";
    assert.equal(isBillingRateLimitEnabled(), true);

    process.env.NODE_ENV = "production";
    delete process.env.BILLING_RATE_LIMIT_ENABLED;
    assert.equal(isBillingRateLimitEnabled(), true);

    process.env.BILLING_RATE_LIMIT_DISABLED = "true";
    assert.equal(isBillingRateLimitEnabled(), false);
  } finally {
    if (saved.enabled === undefined) delete process.env.BILLING_RATE_LIMIT_ENABLED;
    else process.env.BILLING_RATE_LIMIT_ENABLED = saved.enabled;
    if (saved.disabled === undefined) delete process.env.BILLING_RATE_LIMIT_DISABLED;
    else process.env.BILLING_RATE_LIMIT_DISABLED = saved.disabled;
    if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.nodeEnv;
    if (saved.vercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.vercelEnv;
    process.env.BILLING_RATE_LIMIT_ENABLED = "true";
  }
});

// ---------------------------------------------------------------------------
// 1. Limite por IP no IPN: 429 + Retry-After, sem fetch além do teto
// ---------------------------------------------------------------------------

test("1. IPN: rajada por IP recebe 429 com Retry-After e não gera fetch além do teto", async () => {
  useFreshStore();
  const counter = { calls: [] };
  approvedPaymentRpc();
  globalThis.fetch = async (url) => {
    counter.calls.push(String(url));
    return new Response(JSON.stringify(validApprovedPayment(USER_A, "race-concurrent-1")), { status: 200 });
  };

  const total = BILLING_LIMITS.ipnIp.limit + 5;
  let okCount = 0;
  let limitedCount = 0;
  let lastLimited;
  for (let i = 0; i < total; i++) {
    const res = await ipnGet(
      new Request(`http://localhost/api/webhooks/mercadopago/ipn?id=burst-ip-${i}&topic=payment`, { method: "GET" }),
    );
    if (res.status === 429) {
      limitedCount++;
      lastLimited = res;
      const body = await res.json();
      assert.match(body.error, /Muitas requisicoes/);
      assert.ok(!JSON.stringify(body).includes("mp-test-token"), "resposta 429 sem segredos");
    } else {
      assert.equal(res.status, 200);
      okCount++;
    }
  }
  assert.equal(okCount, BILLING_LIMITS.ipnIp.limit);
  assert.equal(limitedCount, 5);
  assert.ok(lastLimited.headers.get("Retry-After"), "429 inclui Retry-After");
  assert.ok(Number(lastLimited.headers.get("Retry-After")) > 0);
  assert.equal(counter.calls.length, BILLING_LIMITS.ipnIp.limit);
});

// ---------------------------------------------------------------------------
// 2. Dedupe por pagamento: rajada do mesmo id gera 1 consulta externa
// ---------------------------------------------------------------------------

test("2. IPN: rajada do mesmo pagamento gera 1 consulta externa (dedupe 200)", async () => {
  useFreshStore();
  const counter = { calls: [] };
  mockMpApproved(USER_A, counter);
  approvedPaymentRpc();

  const first = await ipnPost(
    new Request("http://localhost/api/webhooks/mercadopago/ipn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "https://api.mercadopago.com/v1/payments/dedupe-1", topic: "payment" }),
    }),
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json()).processed, true);

  for (let i = 0; i < 9; i++) {
    const res = await ipnPost(
      new Request("http://localhost/api/webhooks/mercadopago/ipn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "https://api.mercadopago.com/v1/payments/dedupe-1", topic: "payment" }),
      }),
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deduped, true);
  }
  assert.equal(counter.calls.length, 1);
});

// ---------------------------------------------------------------------------
// 3. Isolamento entre usuários distintos (sync)
// ---------------------------------------------------------------------------

test("3. sync: limite de um usuário não afeta outro usuário", async () => {
  useFreshStore();
  approvedPaymentRpc();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: [{ id: "9001", status: "approved", external_reference: USER_A }] }), {
      status: 200,
    });

  authenticatedAs(USER_A);
  const a1 = await syncPost(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
  assert.equal(a1.status, 200);

  const a2 = await syncPost(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
  assert.equal(a2.status, 429);
  assert.ok(a2.headers.get("Retry-After"), "429 inclui Retry-After");

  authenticatedAs(USER_B);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ results: [{ id: "9002", status: "approved", external_reference: USER_B }] }), {
      status: 200,
    });
  const b1 = await syncPost(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
  assert.equal(b1.status, 200);
});

// ---------------------------------------------------------------------------
// 4. Janela de tempo: após expirar, permite novamente
// ---------------------------------------------------------------------------

test("4. store: janela expirada zera a contagem (time window)", async () => {
  const store = new MemoryRateLimitStore();
  const h1 = await store.hit("window-key", 1000);
  assert.equal(h1.count, 1);
  const h2 = await store.hit("window-key", 1000);
  assert.equal(h2.count, 2);
  await new Promise((r) => setTimeout(r, 1100));
  const h3 = await store.hit("window-key", 1000);
  assert.equal(h3.count, 1);
});

// ---------------------------------------------------------------------------
// 5. Concorrência: N paralelos, só `limit` passam
// ---------------------------------------------------------------------------

test("5. limiter: 20 hits concorrentes com limite 5 permitem exatamente 5", async () => {
  useFreshStore();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => checkBillingLimit("billing:test:concurrency", 5, 60_000)),
  );
  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.deepEqual(
    results.map((r) => r.count).sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
});

// ---------------------------------------------------------------------------
// 6. Fail-closed: colapso dos stores distribuídos => 503 + Retry-After,
//    ZERO fetch externo ao Mercado Pago (bloqueador 1 da auditoria externa)
// ---------------------------------------------------------------------------

test("6. colapso: stores distribuídos fora => 503 + Retry-After com zero fetch externo", async () => {
  const secret = "APP_USR-FAILING-STORE-SECRET-XYZ";
  setRateLimitStoreForTesting({
    name: "broken-distributed",
    isDistributed: true,
    hit: async () => {
      throw new Error(`Upstash pipeline failed Bearer ${secret}`);
    },
  });
  const captured = [];
  setLogSinkForTesting((entry) => captured.push(entry));
  const counter = { calls: [] };
  globalThis.fetch = async (url) => {
    counter.calls.push(String(url));
    return new Response(JSON.stringify(validApprovedPayment(USER_A, "race-ipn-1")), { status: 200 });
  };
  try {
    authenticatedAs(USER_A);
    approvedPaymentRpc();

    // checkout: falha temporária segura antes de qualquer consulta externa.
    const checkoutRes = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
    assert.equal(checkoutRes.status, 503);
    assert.equal(checkoutRes.headers.get("Retry-After"), "30");

    // sync: idem.
    const syncRes = await syncPost(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(syncRes.status, 503);
    assert.equal(syncRes.headers.get("Retry-After"), "30");

    // verify: idem.
    const verifyUrl = "http://localhost/api/mercadopago/verify?payment_id=collapse-verify-1";
    const verifyReq = () => ({ nextUrl: new URL(verifyUrl), headers: new Headers(), cookies: { getAll: () => [] } });
    const verifyRes = await verifyGet(verifyReq());
    assert.equal(verifyRes.status, 503);
    assert.equal(verifyRes.headers.get("Retry-After"), "30");

    // webhook: resposta retentável (MP retenta) sem chamar a API externa.
    const webhookRes = await webhookPost(
      new Request("http://localhost/api/webhooks/mercadopago", {
        method: "POST",
        body: JSON.stringify({ type: "payment", data: { id: "collapse-wh-1" } }),
      }),
    );
    assert.equal(webhookRes.status, 503);
    assert.equal(webhookRes.headers.get("Retry-After"), "30");

    // IPN (GET e POST): resposta retentável sem chamar a API externa.
    const ipnGetRes = await ipnGet(
      new Request("http://localhost/api/webhooks/mercadopago/ipn?id=collapse-ipn-1&topic=payment", { method: "GET" }),
    );
    assert.equal(ipnGetRes.status, 503);
    assert.equal(ipnGetRes.headers.get("Retry-After"), "30");
    const ipnPostRes = await ipnPost(
      new Request("http://localhost/api/webhooks/mercadopago/ipn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "https://api.mercadopago.com/v1/payments/collapse-ipn-2", topic: "payment" }),
      }),
    );
    assert.equal(ipnPostRes.status, 503);
    assert.equal(ipnPostRes.headers.get("Retry-After"), "30");

    // Prova de zero fetch externo ao Mercado Pago sob colapso.
    assert.equal(counter.calls.length, 0);

    const fallbackLogs = captured.filter((l) => l.alert_rule === "billing_rate_limit");
    assert.ok(fallbackLogs.length >= 1, "colapso do store deve ser observável");
    const dumped = JSON.stringify(fallbackLogs);
    assert.ok(!dumped.includes(secret), "segredo do erro do store não pode vazar no log");
    assert.ok(dumped.includes("Bearer [REDACTED]"), "Bearer deve ser redigido");
  } finally {
    setLogSinkForTesting(null);
    useFreshStore();
  }
});

// ---------------------------------------------------------------------------
// 7. Kill-switch do IPN legado
// ---------------------------------------------------------------------------

test("7. IPN: desabilitado responde 410 sem consultar o Mercado Pago", async () => {
  useFreshStore();
  const counter = { calls: [] };
  mockMpApproved(USER_A, counter);
  approvedPaymentRpc();

  globalThis.__mockLegacyIpnEnabled = false;
  try {
    const res = await ipnGet(
      new Request("http://localhost/api/webhooks/mercadopago/ipn?id=ipn-disabled-1&topic=payment", { method: "GET" }),
    );
    assert.equal(res.status, 410);
    const body = await res.json();
    assert.equal(body.code, "legacy_ipn_disabled");
    assert.equal(counter.calls.length, 0);
  } finally {
    globalThis.__mockLegacyIpnEnabled = null;
  }

  const res2 = await ipnGet(
    new Request("http://localhost/api/webhooks/mercadopago/ipn?id=ipn-disabled-1&topic=payment", { method: "GET" }),
  );
  assert.equal(res2.status, 200);
  assert.equal(counter.calls.length, 1);
});

// ---------------------------------------------------------------------------
// 8. Tamanho/formato de entrada não gera consulta externa
// ---------------------------------------------------------------------------

test("8. IPN: corpo oversized (413) e id malformado (200 ignored) sem fetch", async () => {
  useFreshStore();
  const counter = { calls: [] };
  mockMpApproved(USER_A, counter);
  approvedPaymentRpc();

  const big = await ipnPost(
    new Request("http://localhost/api/webhooks/mercadopago/ipn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "payment", padding: "x".repeat(40 * 1024) }),
    }),
  );
  assert.equal(big.status, 413);

  const badId = await ipnGet(
    new Request(`http://localhost/api/webhooks/mercadopago/ipn?id=${encodeURIComponent("not a valid id!!")}&topic=payment`, {
      method: "GET",
    }),
  );
  assert.equal(badId.status, 200);
  assert.equal((await badId.json()).ignored, true);
  assert.equal(counter.calls.length, 0);

  assert.equal(getBillingBodySizeOk("x".repeat(40 * 1024)), false);
  assert.equal(isValidBillingPaymentId("not a valid id!!"), false);
  assert.equal(isValidBillingPaymentId("123456"), true);
});

// ---------------------------------------------------------------------------
// 9. Checkout: cooldown 429 + release em falha retentável
// ---------------------------------------------------------------------------

test("9. checkout: 2º POST imediato é 429; falha upstream libera retry imediato", async () => {
  useFreshStore();
  authenticatedAs(USER_A);
  approvedPaymentRpc();
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ id: "pref-checkout-1", init_point: "https://www.mercadopago.com/checkout/v1" }),
      { status: 201 },
    );

  const c1 = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
  assert.equal(c1.status, 200);

  const c2 = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
  assert.equal(c2.status, 429);
  assert.ok(c2.headers.get("Retry-After"), "429 inclui Retry-After");

  // Falha upstream libera o cooldown: retry imediato volta a funcionar.
  useFreshStore();
  authenticatedAs(USER_A);
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) throw new Error("fetch failed: ECONNRESET");
    return new Response(
      JSON.stringify({ id: "pref-checkout-retry", init_point: "https://www.mercadopago.com/checkout/retry" }),
      { status: 201 },
    );
  };
  const f1 = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
  // MAI-144: falha de rede/timeout no POST responde 504 retentável (sem retry
  // automático de POST não idempotente) e libera o cooldown.
  assert.equal(f1.status, 504);
  const f2 = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
  assert.equal(f2.status, 200);
  assert.deepEqual(await f2.json(), { init_point: "https://www.mercadopago.com/checkout/retry" });
});

// ---------------------------------------------------------------------------
// 10. Webhook legítimo: retry após 502 reprocessa (não é dedupado)
// ---------------------------------------------------------------------------

test("10. webhook: retry legítimo após 502 upstream volta a consultar e processa", async () => {
  useFreshStore();
  approvedPaymentRpc();
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) return new Response(JSON.stringify({ message: "Upstream down" }), { status: 503 });
    return new Response(JSON.stringify(validApprovedPayment(USER_A, "race-failrelease-1")), { status: 200 });
  };

  const body = JSON.stringify({ type: "payment", data: { id: "retry-legit-1" } });
  const r1 = await webhookPost(new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body }));
  assert.equal(r1.status, 502);

  const r2 = await webhookPost(new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body }));
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  assert.equal(j2.processed, true);
  assert.notEqual(j2.deduped, true);
  assert.equal(attempt, 2);
});

// ---------------------------------------------------------------------------
// 11. Verify: cooldown por (usuário, pagamento) responde 429 com Retry-After
// ---------------------------------------------------------------------------

test("11. verify: repetição imediata do mesmo pagamento é 429 com Retry-After", async () => {
  useFreshStore();
  authenticatedAs(USER_A);
  approvedPaymentRpc();
  globalThis.fetch = async () =>
    new Response(JSON.stringify(validApprovedPayment(USER_A, "verify-cool-1")), { status: 200 });

  const url = "http://localhost/api/mercadopago/verify?payment_id=verify-cool-1";
  const verifyReq = () => ({ nextUrl: new URL(url), headers: new Headers(), cookies: { getAll: () => [] } });
  const v1 = await verifyGet(verifyReq());
  assert.equal(v1.status, 200);

  const v2 = await verifyGet(verifyReq());
  assert.equal(v2.status, 429);
  assert.ok(v2.headers.get("Retry-After"), "429 inclui Retry-After");
});

// ---------------------------------------------------------------------------
// 12. Store distribuído é preferido quando configurado (não só memória)
// ---------------------------------------------------------------------------

test("12. store: Supabase configurado resolve store distribuído (não local)", async () => {
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  clearRateLimitStoreForTesting();
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    const store = resolveSupabaseStoreIfConfigured();
    assert.ok(store, "store Supabase deve resolver quando configurado");
    assert.equal(store.name, "supabase");
    assert.equal(store.isDistributed, true);
  } finally {
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    useFreshStore();
  }
});

test("13. 429 helper: corpo genérico + teto de Retry-After", async () => {
  const res = buildBillingRateLimitedResponse(9999);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "300");
  assert.deepEqual(await res.json(), { error: "Muitas requisicoes. Tente novamente em instantes." });

  const cooldown = await checkBillingCooldownAndMark("billing:test:cooldown-helper", 60_000);
  assert.equal(cooldown.deduped, false);
  const cooldown2 = await checkBillingCooldownAndMark("billing:test:cooldown-helper", 60_000);
  assert.equal(cooldown2.deduped, true);
  resetBillingRateLimitsForTesting();
});

// ---------------------------------------------------------------------------
// 14. Auditoria §3: dedupe exige prova — sem prova, reprocessa (não descarta)
// ---------------------------------------------------------------------------

test("14. webhook: dedupe sem prova de persistência reprocessa; com prova, deduplica sem fetch", async () => {
  useFreshStore();
  approvedPaymentRpc();
  const counter = { calls: [] };
  mockMpApproved(USER_A, counter);

  const bodyFor = (id) => JSON.stringify({ type: "payment", data: { id } });
  const reqFor = (id) => new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body: bodyFor(id) });

  // Simula marca prematura sem persistência (concorrência em voo / falha anterior):
  // a notificação DEVE ser processada, nunca descartada com 200.
  const premarked = await checkBillingCooldownAndMark(
    `billing:webhook:cooldown:race-noproof-1`,
    BILLING_LIMITS.webhookPaymentCooldownMs,
  );
  assert.equal(premarked.deduped, false);
  const r1 = await webhookPost(reqFor("race-noproof-1"));
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.processed, true);
  assert.notEqual(j1.deduped, true);
  assert.equal(counter.calls.length, 1);

  // Com prova de persistência (payment já processado): dedupe legítimo, sem fetch.
  const before = counter.calls.length;
  const r2 = await webhookPost(reqFor("race-noproof-1"));
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).deduped, true);
  assert.equal(counter.calls.length, before);
});

// ---------------------------------------------------------------------------
// 15. Auditoria §2: Upstash aplica INCR+TTL em 1 única chamada (EVAL Lua)
// ---------------------------------------------------------------------------

test("15. upstash: hit usa EVAL atômico em chamada única, com TTL garantido", async () => {
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ result: [3, 42000] }), { status: 200 });
  };
  try {
    const store = new UpstashRateLimitStore("https://mock.upstash.io", "tok");
    assert.equal(store.isDistributed, true);
    const hit = await store.hit("billing:test:atomic", 60_000);
    assert.deepEqual(hit, { count: 3, ttlMs: 42000 });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/eval"), "incremento e TTL na mesma chamada /eval");
    const [script, numkeys, key, windowArg] = calls[0].body;
    assert.equal(numkeys, 1);
    assert.equal(key, "billing:test:atomic");
    assert.equal(windowArg, "60000");
    assert.ok(String(script).includes("PEXPIRE"), "script garante expiração");

    globalThis.fetch = async () => new Response("upstream down", { status: 500 });
    await assert.rejects(() => store.hit("billing:test:atomic", 60_000), /Upstash eval failed/);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ---------------------------------------------------------------------------
// 15b. MAI-144: Upstash lento estoura o deadline sem travar a rota
// ---------------------------------------------------------------------------

test("15b. upstash: hit com Redis lento rejeita no deadline (AbortSignal.timeout)", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (_url, opts) =>
    new Promise((_resolve, reject) => {
      const signal = opts?.signal;
      const latency = setTimeout(() => {
        reject(new DOMException("Mock upstash excedeu a latência simulada", "AbortError"));
      }, 2000);
      const abortErr = () => {
        clearTimeout(latency);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      if (!signal) return;
      if (signal.aborted) {
        abortErr();
        return;
      }
      signal.addEventListener("abort", abortErr, { once: true });
    });
  try {
    const store = new UpstashRateLimitStore("https://mock.upstash.io", "tok", 50);
    const started = Date.now();
    await assert.rejects(() => store.hit("billing:test:slow", 60_000), (err) => {
      assert.match(err.name, /AbortError|TimeoutError/);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `deadline do Upstash deve estourar rápido (levou ${elapsed}ms)`);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ---------------------------------------------------------------------------
// 16. Bloqueador 2: rajada CONCORRENTE (Promise.all) do mesmo payment ID no
//     webhook gera exatamente 1 consulta externa (in-flight lock distribuído)
// ---------------------------------------------------------------------------

test("16. webhook: rajada concorrente do mesmo pagamento => exatamente 1 fetch; duplicata pós-persistência => 200 deduped", async () => {
  useFreshStore();
  const counter = { calls: [] };
  approvedPaymentRpc();
  globalThis.fetch = async (url) => {
    counter.calls.push(String(url));
    // Delay proposital: mantém o 1º request "em voo" enquanto as duplicatas chegam.
    await new Promise((r) => setTimeout(r, 60));
    return new Response(JSON.stringify(validApprovedPayment(USER_A, "race-concurrent-1")), { status: 200 });
  };

  const body = JSON.stringify({ type: "payment", data: { id: "race-concurrent-1" } });
  const makeReq = () => new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body });

  const results = await Promise.all(Array.from({ length: 10 }, () => webhookPost(makeReq())));
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 429, 429, 429, 429, 429, 429, 429, 429, 429]);

  const bodies = await Promise.all(results.map((r) => r.json()));
  const okBody = bodies.find((b) => b.processed === true);
  assert.ok(okBody, "exatamente 1 request processa");
  assert.notEqual(okBody.deduped, true);
  for (const b of bodies.filter((b) => b !== okBody)) {
    assert.match(b.error, /Muitas requisicoes/);
  }
  for (const r of results.filter((r) => r.status === 429)) {
    assert.ok(r.headers.get("Retry-After"), "429 de contenção inclui Retry-After");
  }
  // Prova de consulta única ao Mercado Pago sob concorrência real.
  assert.equal(counter.calls.length, 1);

  // Duplicata após persistência: 200 deduped SEM novo fetch.
  const dup = await webhookPost(makeReq());
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).deduped, true);
  assert.equal(counter.calls.length, 1);
});

// ---------------------------------------------------------------------------
// 17. Bloqueador 2: rajada CONCORRENTE (Promise.all) do mesmo payment ID no
//     IPN gera exatamente 1 consulta externa
// ---------------------------------------------------------------------------

test("17. IPN: rajada concorrente do mesmo pagamento => exatamente 1 fetch", async () => {
  useFreshStore();
  const counter = { calls: [] };
  approvedPaymentRpc();
  globalThis.fetch = async (url) => {
    counter.calls.push(String(url));
    await new Promise((r) => setTimeout(r, 50));
    return new Response(JSON.stringify(validApprovedPayment(USER_A, "race-ipn-1")), { status: 200 });
  };

  const makeReq = () =>
    new Request("http://localhost/api/webhooks/mercadopago/ipn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "https://api.mercadopago.com/v1/payments/race-ipn-1", topic: "payment" }),
    });

  const results = await Promise.all(Array.from({ length: 5 }, () => ipnPost(makeReq())));
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 429, 429, 429, 429]);
  assert.equal(counter.calls.length, 1);

  const dup = await ipnPost(makeReq());
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).deduped, true);
  assert.equal(counter.calls.length, 1);
});

// ---------------------------------------------------------------------------
// 18. Bloqueador 2: falha retentável do dono libera o in-flight — o retry
//     legítimo volta a consultar e processa (não fica preso nem dedupado)
// ---------------------------------------------------------------------------

test("18. webhook: falha do dono libera o in-flight; retry legítimo reprocessa", async () => {
  useFreshStore();
  approvedPaymentRpc();
  let attempt = 0;
  const counter = { calls: [] };
  globalThis.fetch = async (url) => {
    attempt++;
    counter.calls.push(String(url));
    if (attempt === 1) {
      await new Promise((r) => setTimeout(r, 30));
      throw new Error("fetch failed: ECONNRESET");
    }
    return new Response(JSON.stringify(validApprovedPayment(USER_A, "race-failrelease-1")), { status: 200 });
  };

  const body = JSON.stringify({ type: "payment", data: { id: "race-failrelease-1" } });
  const makeReq = () => new Request("http://localhost/api/webhooks/mercadopago", { method: "POST", body });

  // Dono falha em voo + duplicata concorrente: 1x502 + 1x429, 1 fetch total.
  const burst = await Promise.all([webhookPost(makeReq()), webhookPost(makeReq())]);
  assert.deepEqual(burst.map((r) => r.status).sort((a, b) => a - b), [429, 502]);
  assert.equal(counter.calls.length, 1);

  // Retry legítimo após a falha: volta a consultar e processa (não dedupado).
  const retry = await webhookPost(makeReq());
  assert.equal(retry.status, 200);
  const retryJson = await retry.json();
  assert.equal(retryJson.processed, true);
  assert.notEqual(retryJson.deduped, true);
  assert.equal(counter.calls.length, 2);
});

// ---------------------------------------------------------------------------
// 19. Auditoria Luna Extra Alto: release da RPC Supabase é unlock total —
//     após contenção concorrente (múltiplos hits), o release desbloqueia
//     completamente o bucket (retry legítimo não recebe 429 preso)
// ---------------------------------------------------------------------------

// Admin Supabase simulado com semântica fiel às RPCs da migration
// `supabase/migrations/20260930000000_billing_rate_limits.sql`:
// hit = incremento atômico com janela; release = DELETE (unlock total).
function makeSimulatedSupabaseAdmin() {
  const rows = new Map();
  return {
    rows,
    rpc: async (fn, params) => {
      if (fn === "billing_rate_limit_hit") {
        const key = String(params?.p_bucket_key ?? "");
        const windowMs = Math.max(1, Math.ceil(Number(params?.p_window_seconds ?? 60))) * 1000;
        const now = Date.now();
        let row = rows.get(key);
        if (!row || row.expiresAt <= now) {
          row = { count: 1, expiresAt: now + windowMs };
          rows.set(key, row);
        } else {
          row.count += 1;
        }
        return { data: { count: row.count, ttl_ms: Math.max(0, row.expiresAt - now) }, error: null };
      }
      if (fn === "billing_rate_limit_release") {
        // Espelha a migration corrigida: DELETE, nunca decremento.
        rows.delete(String(params?.p_bucket_key ?? ""));
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  };
}

test("19. supabase: release após contenção concorrente desbloqueia totalmente o bucket", async () => {
  // 19a. Guarda da migration: a RPC de release declara DELETE (unlock total)
  // e não mais o decremento `hit_count - 1`.
  const migrationPath = path.join(__rlDir, "..", "supabase", "migrations", "20260930000000_billing_rate_limits.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  const releaseStart = migrationSql.indexOf("billing_rate_limit_release(");
  assert.ok(releaseStart >= 0, "migration deve declarar billing_rate_limit_release");
  const releaseSql = migrationSql.slice(releaseStart).toLowerCase();
  assert.ok(
    releaseSql.includes("delete from public.billing_rate_limits"),
    "release deve remover o registro (DELETE/unlock total)",
  );
  assert.ok(!releaseSql.includes("hit_count - 1"), "release não pode decrementar o contador");

  // 19b. Contenção concorrente + release: o bucket desbloqueia por completo.
  const admin = makeSimulatedSupabaseAdmin();
  const store = new SupabaseRateLimitStore(() => admin);
  assert.equal(store.isDistributed, true);
  setRateLimitStoreForTesting(store);
  try {
    const key = "billing:test:supabase-release";
    const burst = await Promise.all(Array.from({ length: 5 }, () => checkBillingCooldownAndMark(key, 30_000)));
    assert.ok(burst.every((r) => !r.collapsed), "store simulado operacional não colapsa");
    assert.equal(burst.filter((r) => !r.deduped).length, 1, "só 1 request adquire o lock");
    assert.equal(admin.rows.get(key)?.count, 5, "contenção eleva o contador");

    // O dono falha e libera: unlock total, não decremento (5 -> 4 ainda preso).
    await releaseBillingCooldown(key, store.name);
    assert.ok(!admin.rows.has(key), "release deve remover o bucket por completo");

    const after = await checkBillingCooldownAndMark(key, 30_000);
    assert.equal(after.collapsed, false);
    assert.equal(after.deduped, false, "retry legítimo pós-release não pode ser dedupado/429 preso");
  } finally {
    useFreshStore();
  }
});
