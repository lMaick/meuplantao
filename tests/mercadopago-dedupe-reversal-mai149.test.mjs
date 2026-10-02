import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

// MAI-149 — dedupe persistente por payment_id não pode impedir observação de
// mudança de status (approved -> refunded/charged_back).
// approved repetido segue idempotente via RPC (sem nova vigência); reversões
// chegam a reconcileMercadoPagoReversal(); reversão repetida idempotente;
// concorrência sem dupla concessão/reversão; rate limit/cooldown/inflight mantidos.

process.env.BILLING_RATE_LIMIT_ENABLED = "true";
delete process.env.BILLING_RATE_LIMIT_DISABLED;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const __mai149File = fileURLToPath(import.meta.url);
const __mai149Dir = path.dirname(__mai149File);
const fileUrl = (p) => pathToFileURL(path.join(__mai149Dir, "..", p)).href;
const __trialUrl = fileUrl("src/lib/subscription/trial.ts");
const __paymentsUrl = fileUrl("src/lib/mercadopago/payments.ts");
const __webhookUrl = fileUrl("src/lib/mercadopago/webhook.ts");
const __observabilityUrl = fileUrl("src/lib/observability/index.ts");
const __rateLimitUrl = fileUrl("src/lib/billing/rate-limit.ts");
const __reversalsUrl = fileUrl("src/lib/mercadopago/reversals.ts");
const __httpUrl = fileUrl("src/lib/mercadopago/http.ts");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __observabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: __trialUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: __paymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: __webhookUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/reversals") return { url: __reversalsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/http") return { url: __httpUrl, shortCircuit: true };
    if (specifier === "@/lib/billing/rate-limit") return { url: __rateLimitUrl, shortCircuit: true };
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

const { POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { POST: ipnPost } = await import("../src/app/api/webhooks/mercadopago/ipn/route.ts");
const {
  MemoryRateLimitStore,
  resetBillingRateLimitsForTesting,
  setRateLimitStoreForTesting,
} = await import("../src/lib/billing/rate-limit.ts");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECKOUT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Ledger em memória simulando subscription_payments + subscriptions.
const ledger = new Map(); // paymentId -> { status, userId }
let subState = { current_period_end: null, status: "expired" };
let processCalls = [];
let reconcileCalls = [];
let fetchCalls = 0;
const mpStatusByPayment = new Map(); // paymentId -> provider status

function useFreshMai149() {
  setRateLimitStoreForTesting(new MemoryRateLimitStore());
  resetBillingRateLimitsForTesting();
  ledger.clear();
  mpStatusByPayment.clear();
  processCalls = [];
  reconcileCalls = [];
  fetchCalls = 0;
  subState = { current_period_end: null, status: "expired" };
  globalThis.__mockWebhookSecret = null;
  globalThis.__mockLegacyIpnEnabled = true;

  const futureEndFor = (days = 30) => new Date(Date.now() + days * 86400000).toISOString();

  globalThis.adminClient = {
    rpc: async (fn, params) => {
      if (fn === "process_mercadopago_subscription_payment") {
        const pid = String(params?.p_payment_id);
        processCalls.push({ fn, params });
        if (ledger.has(pid)) {
          return {
            data: {
              already_processed: true,
              current_period_end: subState.current_period_end,
              validity_days_added: 0,
              status: subState.current_period_end && new Date(subState.current_period_end) > new Date() ? "active" : "expired",
            },
            error: null,
          };
        }
        ledger.set(pid, { status: "approved", userId: params?.p_user_id });
        const days = Number(params?.p_validity_days || 30);
        const now = new Date();
        const base = subState.current_period_end && new Date(subState.current_period_end) > now
          ? new Date(subState.current_period_end)
          : now;
        const end = new Date(base.getTime() + days * 86400000).toISOString();
        subState = { current_period_end: end, status: "active" };
        return {
          data: { already_processed: false, current_period_end: end, validity_days_added: days, status: "active" },
          error: null,
        };
      }
      if (fn === "reconcile_mercadopago_reversal") {
        const pid = String(params?.p_payment_id);
        const rev = String(params?.p_reversal_status || "refunded");
        reconcileCalls.push({ fn, params });
        const row = ledger.get(pid);
        if (row && row.status === rev) {
          return {
            data: {
              reversed: false, already_reversed: true, not_found: false, ownership_mismatch: false,
              contributed: false, current_period_end: subState.current_period_end, status: subState.status,
              active_payments: 0, validity_days_removed: 0,
            },
            error: null,
          };
        }
        if (row && row.status === "approved") {
          ledger.set(pid, { status: rev, userId: row.userId });
          // Recompõe vigência: remove contribuição (volta ao passado/expirado quando único pagamento).
          const stillApproved = Array.from(ledger.values()).filter((r) => r.status === "approved").length;
          if (stillApproved === 0) {
            subState = { current_period_end: new Date(Date.now() - 1000).toISOString(), status: "expired" };
          }
          return {
            data: {
              reversed: true, already_reversed: false, not_found: false, ownership_mismatch: false,
              contributed: true, current_period_end: subState.current_period_end, status: "expired",
              active_payments: stillApproved, validity_days_removed: 30,
            },
            error: null,
          };
        }
        // Not found (stub): não contribui, não revoga.
        return {
          data: {
            reversed: false, already_reversed: false, not_found: true, ownership_mismatch: false,
            contributed: false, current_period_end: subState.current_period_end, status: subState.status,
            active_payments: 0, validity_days_removed: 0,
          },
          error: null,
        };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
    from: (table) => ({
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            if (table === "subscription_payments") {
              return ledger.has(String(val))
                ? { data: { mercadopago_payment_id: String(val) }, error: null }
                : { data: null, error: null };
            }
            if (table === "subscription_checkouts") {
              return {
                data: {
                  id: CHECKOUT_ID,
                  user_id: USER_A,
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
            if (table === "subscriptions") {
              return { data: { ...subState }, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: () => ({ eq: () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  };

  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    const u = String(url);
    const m = u.match(/\/v1\/payments\/([^\/?#]+)/);
    const pid = m ? decodeURIComponent(m[1]) : "unknown";
    const status = mpStatusByPayment.get(pid) || "approved";
    return new Response(JSON.stringify({
      id: pid,
      status,
      external_reference: `${USER_A}#1#${CHECKOUT_ID}`,
      currency_id: "BRL",
      transaction_amount: 12.9,
      preference_id: "pref-mai149-1",
      metadata: { user_id: USER_A, months: 1, checkout_id: CHECKOUT_ID },
    }), { status: 200 });
  };
}

// Simula expiração da janela curta de cooldown mantendo o ledger (prova persistente).
function expireCooldownWindowOnly() {
  resetBillingRateLimitsForTesting();
  setRateLimitStoreForTesting(new MemoryRateLimitStore());
}

const webhookReqFor = (paymentId) => new Request("http://localhost/api/webhooks/mercadopago", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
});

const ipnReqFor = (paymentId) => new Request("http://localhost/api/webhooks/mercadopago/ipn", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ resource: `https://api.mercadopago.com/v1/payments/${paymentId}`, topic: "payment" }),
});

test("MAI-149: webhook approved -> approved repetido é idempotente sem nova vigência (consulta estado atual)", async () => {
  useFreshMai149();
  const pid = "mai149-approved-repeat-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await webhookPost(webhookReqFor(pid));
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.processed, true);
  assert.equal(j1.already_processed, false);
  const firstEnd = j1.current_period_end;
  assert.ok(firstEnd);
  assert.equal(processCalls.length, 1);
  assert.equal(fetchCalls, 1);

  // Expira só o cooldown; ledger persiste (cenário do bug: payment_id já visto).
  expireCooldownWindowOnly();
  const r2 = await webhookPost(webhookReqFor(pid));
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  // MAI-149: deve CONSULTAR o MP de novo (fetch 2) e responder idempotente via RPC,
  // nunca `deduped` terminal sem fetch.
  assert.equal(fetchCalls, 2);
  assert.equal(j2.processed, true);
  assert.equal(j2.already_processed, true);
  assert.equal(j2.current_period_end, firstEnd);
  assert.equal(processCalls.length, 2);
  assert.equal(reconcileCalls.length, 0);
});

test("MAI-149: webhook approved -> refunded executa reconcileMercadoPagoReversal()", async () => {
  useFreshMai149();
  const pid = "mai149-approved-refunded-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await webhookPost(webhookReqFor(pid));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).processed, true);
  assert.equal(ledger.get(pid)?.status, "approved");

  expireCooldownWindowOnly();
  mpStatusByPayment.set(pid, "refunded");

  const r2 = await webhookPost(webhookReqFor(pid));
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  assert.equal(j2.reversed, true);
  assert.equal(j2.already_reversed, false);
  assert.equal(fetchCalls, 2);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "refunded");
});

test("MAI-149: webhook approved -> charged_back executa reconciliação", async () => {
  useFreshMai149();
  const pid = "mai149-approved-chargeback-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await webhookPost(webhookReqFor(pid));
  assert.equal((await r1.json()).processed, true);

  expireCooldownWindowOnly();
  mpStatusByPayment.set(pid, "charged_back");

  const r2 = await webhookPost(webhookReqFor(pid));
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(j2.reversed, true);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "charged_back");
});

test("MAI-149: webhook reversão repetida é idempotente sem dupla remoção", async () => {
  useFreshMai149();
  const pid = "mai149-reversal-repeat-1";
  mpStatusByPayment.set(pid, "approved");
  await webhookPost(webhookReqFor(pid));

  expireCooldownWindowOnly();
  mpStatusByPayment.set(pid, "refunded");
  const rr1 = await webhookPost(webhookReqFor(pid));
  const jr1 = await rr1.json();
  assert.equal(jr1.reversed, true);
  const endAfterFirstReversal = jr1.current_period_end;

  expireCooldownWindowOnly();
  const rr2 = await webhookPost(webhookReqFor(pid));
  const jr2 = await rr2.json();
  assert.equal(rr2.status, 200);
  assert.equal(jr2.reversed, true);
  assert.equal(jr2.already_reversed, true);
  assert.equal(jr2.current_period_end, endAfterFirstReversal);
  assert.equal(reconcileCalls.length, 2);
});

test("MAI-149: webhook concorrência do mesmo payment_id gera 1 fetch sem dupla concessão", async () => {
  useFreshMai149();
  const pid = "mai149-concurrent-1";
  mpStatusByPayment.set(pid, "approved");
  // Delay no fetch para manter a 1ª requisição em voo durante a rajada.
  const baseFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    await new Promise((r) => setTimeout(r, 60));
    return baseFetch(url);
  };

  const results = await Promise.all(Array.from({ length: 10 }, () => webhookPost(webhookReqFor(pid))));
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
  assert.equal(fetchCalls, 1);
  assert.equal(processCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "approved");
});

test("MAI-149: IPN approved -> refunded preserva reversão apesar do ledger já conter payment_id", async () => {
  useFreshMai149();
  const pid = "mai149-ipn-refund-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await ipnPost(ipnReqFor(pid));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).processed, true);

  expireCooldownWindowOnly();
  mpStatusByPayment.set(pid, "refunded");

  const r2 = await ipnPost(ipnReqFor(pid));
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(j2.reversed, true);
  assert.equal(fetchCalls, 2);
  assert.equal(reconcileCalls.length, 1);
});

test("MAI-149: IPN approved repetido + reversão repetida idempotentes", async () => {
  useFreshMai149();
  const pid = "mai149-ipn-repeat-1";
  mpStatusByPayment.set(pid, "approved");
  await ipnPost(ipnReqFor(pid));

  expireCooldownWindowOnly();
  const dup = await ipnPost(ipnReqFor(pid));
  const jdup = await dup.json();
  assert.equal(dup.status, 200);
  assert.equal(jdup.processed, true);
  assert.equal(jdup.already_processed, true);

  expireCooldownWindowOnly();
  mpStatusByPayment.set(pid, "charged_back");
  const rev1 = await ipnPost(ipnReqFor(pid));
  assert.equal((await rev1.json()).reversed, true);

  expireCooldownWindowOnly();
  const rev2 = await ipnPost(ipnReqFor(pid));
  const jrev2 = await rev2.json();
  assert.equal(jrev2.already_reversed, true);
});

// ---------------------------------------------------------------------------
// Auditoria 2026-10-02 (finding bloqueador): reversão DENTRO do cooldown curto
// (15s webhook / 30s IPN), SEM reset manual e SEM segunda notificação.
// O cooldown NÃO pode retornar 200 `deduped:true` sem consultar o MP —
// a transição approved -> refunded/charged_back chegaria dentro da janela e
// seria perdida (200 não garante retry). Correção: consulta o estado atual
// mesmo no cooldown (lock in-flight protege rajada concorrente com 429).
// ---------------------------------------------------------------------------

test("MAI-149 auditoria: webhook approved -> refunded DENTRO do cooldown (sem reset, sem reenvio)", async () => {
  useFreshMai149();
  const pid = "mai149-audit-webhook-refund-incooldown-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await webhookPost(webhookReqFor(pid));
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.processed, true);
  assert.equal(j1.already_processed, false);
  const firstEnd = j1.current_period_end;
  assert.ok(firstEnd);
  assert.equal(fetchCalls, 1);
  assert.equal(processCalls.length, 1);

  // Transição ocorre DENTRO da janela de 15s: NENHUM reset de cooldown/store,
  // NENHUMA segunda notificação manual — a próxima notificação do provedor é a
  // própria reversão e deve ser observada imediatamente.
  mpStatusByPayment.set(pid, "refunded");

  const r2 = await webhookPost(webhookReqFor(pid));
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  // NUNCA `deduped:true` terminal sem fetch dentro do cooldown.
  assert.notEqual(j2.deduped, true);
  assert.equal(j2.reversed, true);
  assert.equal(j2.already_reversed, false);
  assert.equal(fetchCalls, 2);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "refunded");
  // Sem dupla concessão: só 1 concessão, 1 reversão.
  assert.equal(processCalls.length, 1);
});

test("MAI-149 auditoria: webhook approved -> charged_back DENTRO do cooldown (sem reset, sem reenvio)", async () => {
  useFreshMai149();
  const pid = "mai149-audit-webhook-cb-incooldown-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await webhookPost(webhookReqFor(pid));
  assert.equal((await r1.json()).processed, true);
  assert.equal(fetchCalls, 1);

  mpStatusByPayment.set(pid, "charged_back");

  const r2 = await webhookPost(webhookReqFor(pid));
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.notEqual(j2.deduped, true);
  assert.equal(j2.reversed, true);
  assert.equal(fetchCalls, 2);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "charged_back");
  assert.equal(processCalls.length, 1);
});

test("MAI-149 auditoria: webhook approved repetido DENTRO do cooldown consulta MP e é idempotente", async () => {
  useFreshMai149();
  const pid = "mai149-audit-webhook-repeat-incooldown-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await webhookPost(webhookReqFor(pid));
  const j1 = await r1.json();
  assert.equal(j1.processed, true);
  const firstEnd = j1.current_period_end;

  // Mesmo status, ainda dentro dos 15s: deve CONSULTAR (fetch 2) e responder
  // idempotente via RPC — nunca `deduped:true` sem fetch.
  const r2 = await webhookPost(webhookReqFor(pid));
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.notEqual(j2.deduped, true);
  assert.equal(j2.processed, true);
  assert.equal(j2.already_processed, true);
  assert.equal(j2.current_period_end, firstEnd);
  assert.equal(fetchCalls, 2);
  assert.equal(processCalls.length, 2);
  assert.equal(reconcileCalls.length, 0);
});

test("MAI-149 auditoria: IPN approved -> refunded DENTRO do cooldown (sem reset, sem reenvio)", async () => {
  useFreshMai149();
  const pid = "mai149-audit-ipn-refund-incooldown-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await ipnPost(ipnReqFor(pid));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).processed, true);
  assert.equal(fetchCalls, 1);

  mpStatusByPayment.set(pid, "refunded");

  const r2 = await ipnPost(ipnReqFor(pid));
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.notEqual(j2.deduped, true);
  assert.equal(j2.reversed, true);
  assert.equal(j2.already_reversed, false);
  assert.equal(fetchCalls, 2);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "refunded");
  assert.equal(processCalls.length, 1);
});

test("MAI-149 auditoria: IPN approved -> charged_back DENTRO do cooldown (sem reset, sem reenvio)", async () => {
  useFreshMai149();
  const pid = "mai149-audit-ipn-cb-incooldown-1";
  mpStatusByPayment.set(pid, "approved");

  const r1 = await ipnPost(ipnReqFor(pid));
  assert.equal((await r1.json()).processed, true);

  mpStatusByPayment.set(pid, "charged_back");

  const r2 = await ipnPost(ipnReqFor(pid));
  const j2 = await r2.json();
  assert.equal(r2.status, 200);
  assert.notEqual(j2.deduped, true);
  assert.equal(j2.reversed, true);
  assert.equal(fetchCalls, 2);
  assert.equal(reconcileCalls.length, 1);
  assert.equal(ledger.get(pid)?.status, "charged_back");
  assert.equal(processCalls.length, 1);
});

test("MAI-149 auditoria: reversão repetida DENTRO do cooldown é idempotente sem dupla remoção", async () => {
  useFreshMai149();
  const pid = "mai149-audit-reversal-repeat-incooldown-1";
  mpStatusByPayment.set(pid, "approved");
  await webhookPost(webhookReqFor(pid));

  // Primeira reversão ainda dentro do cooldown da concessão.
  mpStatusByPayment.set(pid, "refunded");
  const rr1 = await webhookPost(webhookReqFor(pid));
  const jr1 = await rr1.json();
  assert.equal(jr1.reversed, true);
  assert.equal(jr1.already_reversed, false);
  const endAfterFirstReversal = jr1.current_period_end;

  // Segunda entrega da MESMA reversão, ainda dentro do cooldown: idempotente.
  const rr2 = await webhookPost(webhookReqFor(pid));
  const jr2 = await rr2.json();
  assert.equal(rr2.status, 200);
  assert.notEqual(jr2.deduped, true);
  assert.equal(jr2.reversed, true);
  assert.equal(jr2.already_reversed, true);
  assert.equal(jr2.current_period_end, endAfterFirstReversal);
  assert.equal(reconcileCalls.length, 2);
  assert.equal(processCalls.length, 1);
});
