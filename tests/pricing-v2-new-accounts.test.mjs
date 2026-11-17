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
const __mpHttpUrl = pathToFileURL(path.join(path.dirname(__mpRoutesFile), "..", "src", "lib", "mercadopago", "http.ts")).href;
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
    if (specifier === "@/lib/mercadopago/http") {
      return { url: __mpHttpUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") return { url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-token'; export const getMercadoPagoWebhookSecret = () => null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com'; export const isProductionEnvironment = () => process.env.VERCEL_ENV?.trim() === 'production' || process.env.NODE_ENV?.trim() === 'production'; export const isMissingWebhookSecretAllowed = () => { if (isProductionEnvironment()) return false; const raw = process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET?.trim().toLowerCase(); return raw !== 'false' && raw !== '0' && raw !== 'no'; }; export const getWebhookSetupState = () => ({ configured: false, failClosed: !isMissingWebhookSecretAllowed() });", shortCircuit: true };
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") return { url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});
const { POST: checkout } = await import("../src/app/api/mercadopago/checkout/route.ts");
const {
  getCatalogVersionForAccount,
  getCanonicalPlanByMonths,
  validatePaymentBeforeGrantingPro,
  PRICING_V2_CUTOFF_AT,
  PRICING_V2_CATALOG_VERSION,
  DEFAULT_CATALOG_VERSION,
} = await import("../src/lib/mercadopago/payments.ts");

const userId = "11111111-1111-4111-8111-111111111111";
const BEFORE = new Date(new Date(PRICING_V2_CUTOFF_AT).getTime() - 1000).toISOString();
const AFTER = PRICING_V2_CUTOFF_AT;

function request(months, extra = {}) {
  return new Request("http://localhost/api/mercadopago/checkout", {
    method: "POST",
    body: JSON.stringify({ months, ...extra }),
  });
}

function setup(createdAt) {
  const inserts = [];
  const calls = [];
  globalThis.authenticatedClient = {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "u@example.com", created_at: createdAt } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  globalThis.adminClient = {
    from: () => ({
      insert: async (row) => { inserts.push(row); return { error: null }; },
      update: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "x" }, error: null }) }) }), eq: async () => ({ error: null }) }) }),
    }),
  };
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "pref-v2", init_point: "https://www.mercadopago.com/checkout/v1" }), { status: 201 });
  };
  return { inserts, calls };
}

test("catálogo é decidido pela data de criação da conta, com corte exato", () => {
  assert.equal(getCatalogVersionForAccount(BEFORE), DEFAULT_CATALOG_VERSION);
  assert.equal(getCatalogVersionForAccount(AFTER), PRICING_V2_CATALOG_VERSION);
  assert.equal(getCatalogVersionForAccount(null), DEFAULT_CATALOG_VERSION);
  assert.equal(getCatalogVersionForAccount("lixo"), DEFAULT_CATALOG_VERSION);
});

test("catálogo v2 tem os preços aprovados; v1 permanece intacto", () => {
  const v2 = Object.fromEntries([1, 3, 6, 12].map((m) => [m, getCanonicalPlanByMonths(m, PRICING_V2_CATALOG_VERSION).priceCents]));
  assert.deepEqual(v2, { 1: 1990, 3: 5970, 6: 10790, 12: 17990 });
  const v1 = Object.fromEntries([1, 3, 6, 12].map((m) => [m, getCanonicalPlanByMonths(m).priceCents]));
  assert.deepEqual(v1, { 1: 1290, 3: 3870, 6: 6990, 12: 12990 });
  assert.equal(getCanonicalPlanByMonths(12, PRICING_V2_CATALOG_VERSION).badge, "Melhor valor");
});

for (const [months, oldCents, newCents] of [[1, 1290, 1990], [3, 3870, 5970], [6, 6990, 10790], [12, 12990, 17990]]) {
  test(`checkout ${months} meses: conta antiga cobra ${oldCents}, conta nova cobra ${newCents}`, async () => {
    const old = setup(BEFORE);
    assert.equal((await checkout(request(months))).status, 200);
    assert.equal(old.inserts[0].amount_cents, oldCents);
    assert.equal(old.inserts[0].catalog_version, DEFAULT_CATALOG_VERSION);
    assert.equal(old.calls[0].items[0].unit_price, oldCents / 100);

    const fresh = setup(AFTER);
    assert.equal((await checkout(request(months))).status, 200);
    assert.equal(fresh.inserts[0].amount_cents, newCents);
    assert.equal(fresh.inserts[0].catalog_version, PRICING_V2_CATALOG_VERSION);
    assert.equal(fresh.calls[0].items[0].unit_price, newCents / 100);
  });
}

test("parâmetros de catálogo/preço vindos do navegador são ignorados", async () => {
  const old = setup(BEFORE);
  await checkout(request(1, { catalog_version: PRICING_V2_CATALOG_VERSION, catalogVersion: PRICING_V2_CATALOG_VERSION, price: 1, amount_cents: 1 }));
  assert.equal(old.inserts[0].amount_cents, 1290);
  assert.equal(old.inserts[0].catalog_version, DEFAULT_CATALOG_VERSION);
});

function adminWithQuote(quote) {
  return {
    from: (table) => table === "subscription_checkouts"
      ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: quote }) }) }) }) }
      : {},
  };
}

const quote = (cents, version) => ({
  id: "33333333-3333-4333-8333-333333333333", user_id: userId, plan_id: "meuplantao-pro-1", months: 1, validity_days: 30,
  amount: cents / 100, amount_cents: cents, price_cents: cents, currency: "BRL", catalog_version: version,
  preference_id: null, completed_payment_id: null, expires_at: new Date(Date.now() + 86400000).toISOString(),
});
const payment = (amount) => ({
  id: `pay-${amount}`, status: "approved", currency_id: "BRL", transaction_amount: amount,
  external_reference: `${userId}#1#33333333-3333-4333-8333-333333333333`, metadata: { user_id: userId, checkout_id: "33333333-3333-4333-8333-333333333333", months: 1 },
});

test("cotação v2 aceita 19,90 e recusa 12,90 (valor antigo) e valores errados", async () => {
  const admin = adminWithQuote(quote(1990, PRICING_V2_CATALOG_VERSION));
  const ok = await validatePaymentBeforeGrantingPro(admin, payment(19.9));
  assert.equal(ok.valid, true);
  assert.equal(ok.catalogVersion, PRICING_V2_CATALOG_VERSION);
  for (const wrong of [12.9, 19.89, 0.01]) {
    const res = await validatePaymentBeforeGrantingPro(admin, payment(wrong));
    assert.equal(res.valid, false);
    assert.equal(res.reason, "amount_mismatch");
  }
});

test("checkout iniciado no catálogo antigo continua válido a 12,90 e recusa 19,90", async () => {
  const admin = adminWithQuote(quote(1290, DEFAULT_CATALOG_VERSION));
  const ok = await validatePaymentBeforeGrantingPro(admin, payment(12.9));
  assert.equal(ok.valid, true);
  assert.equal(ok.catalogVersion, DEFAULT_CATALOG_VERSION);
  const bad = await validatePaymentBeforeGrantingPro(admin, payment(19.9));
  assert.equal(bad.valid, false);
  assert.equal(bad.reason, "amount_mismatch");
});

test("pagamento sem cotação com valor fora de qualquer catálogo é amount_mismatch; valor de catálogo vai para revisão", async () => {
  const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) };
  const base = { status: "approved", currency_id: "BRL", external_reference: userId, metadata: { user_id: userId, months: 1 } };
  const bad = await validatePaymentBeforeGrantingPro(admin, { ...base, id: "u1", transaction_amount: 15 });
  assert.equal(bad.reason, "amount_mismatch");
  const known = await validatePaymentBeforeGrantingPro(admin, { ...base, id: "u2", transaction_amount: 19.9 });
  assert.equal(known.valid, false);
  assert.equal(known.reason, "unlinked_payment_requires_review");
});
