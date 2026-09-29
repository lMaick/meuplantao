import assert from "node:assert/strict";
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

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __rlObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: __rlTrialUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: __rlPaymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: __rlWebhookUrl, shortCircuit: true };
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
  buildBillingRateLimitedResponse,
  checkBillingCooldownAndMark,
  checkBillingLimit,
  clearRateLimitStoreForTesting,
  getBillingBodySizeOk,
  isBillingRateLimitEnabled,
  isValidBillingPaymentId,
  resetBillingRateLimitsForTesting,
  resolveSupabaseStoreIfConfigured,
  setRateLimitStoreForTesting,
} = await import("../src/lib/billing/rate-limit.ts");
const { setLogSinkForTesting } = await import("../src/lib/observability/index.ts");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function useFreshStore() {
  setRateLimitStoreForTesting(new MemoryRateLimitStore());
  resetBillingRateLimitsForTesting();
  globalThis.__mockWebhookSecret = null;
  globalThis.__mockLegacyIpnEnabled = null;
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
    rpc: async () => ({
      data: { already_processed: false, current_period_end: futureEnd, validity_days_added: 30, status: "active" },
      error: null,
    }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { status: "active", current_period_end: futureEnd }, error: null }),
        }),
      }),
    }),
  };
  return futureEnd;
}

function mockMpApproved(externalReference, counter) {
  globalThis.fetch = async (url) => {
    counter.calls.push(String(url));
    return new Response(JSON.stringify({ status: "approved", external_reference: externalReference }), { status: 200 });
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
    return new Response(JSON.stringify({ status: "approved", external_reference: USER_A }), { status: 200 });
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
// 6. Fallback seguro: store quebrado => fail-open + log sanitizado
// ---------------------------------------------------------------------------

test("6. fallback: store com falha libera a rota e registra sem vazar segredo", async () => {
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
  try {
    authenticatedAs(USER_A);
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ init_point: "https://www.mercadopago.com/checkout/v1" }), { status: 201 });

    const res = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { init_point: "https://www.mercadopago.com/checkout/v1" });

    const fallbackLogs = captured.filter((l) => l.alert_rule === "billing_rate_limit");
    assert.ok(fallbackLogs.length >= 1, "fallback do store deve ser observável");
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
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ init_point: "https://www.mercadopago.com/checkout/v1" }), { status: 201 });

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
    return new Response(JSON.stringify({ init_point: "https://www.mercadopago.com/checkout/retry" }), { status: 201 });
  };
  const f1 = await checkoutPost(new Request("http://localhost/api/mercadopago/checkout", { method: "POST" }));
  assert.equal(f1.status, 500);
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
    return new Response(JSON.stringify({ status: "approved", external_reference: USER_A }), { status: 200 });
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
    new Response(JSON.stringify({ status: "approved", external_reference: USER_A }), { status: 200 });

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
