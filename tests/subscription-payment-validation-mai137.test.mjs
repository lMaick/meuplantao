import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test, { describe } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paymentsUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "payments.ts")).href;
const observabilityUrl = pathToFileURL(path.join(ROOT, "src", "lib", "observability", "index.ts")).href;

const configUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "config.ts")).href;
const webhookUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "webhook.ts")).href;
const reversalsUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "reversals.ts")).href;
const rateLimitUrl = pathToFileURL(path.join(ROOT, "src", "lib", "billing", "rate-limit.ts")).href;

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-token";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    }
    if (specifier === "@/lib/observability") return { url: observabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: paymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/reversals") return { url: reversalsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/config") return { url: configUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: webhookUrl, shortCircuit: true };
    if (specifier === "@/lib/billing/rate-limit") return { url: rateLimitUrl, shortCircuit: true };
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") {
      return {
        url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  CANONICAL_PLANS,
  getCanonicalPlanByMonths,
  getCanonicalPlanById,
  isSupportedMonths,
  isSupportedPlanId,
  toCents,
  validatePaymentBeforeGrantingPro,
  quarantinePayment,
  completeSubscriptionCheckout,
} = await import("../src/lib/mercadopago/payments.ts");

const { POST: webhookRoute } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { GET: verifyRoute } = await import("../src/app/api/mercadopago/verify/route.ts");
const { POST: syncRoute } = await import("../src/app/api/mercadopago/sync/route.ts");

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

describe("MAI-137: Catálogo Canônico e Validação Financeira Pré-Concessão de Pro", () => {
  // ─── 1. Catálogo Canônico ──────────────────────────────────────────────────
  test("1. Catálogo canônico define 1, 3, 6 e 12 meses com preços, centavos e moeda BRL", () => {
    assert.equal(CANONICAL_PLANS.length, 4);

    const m1 = getCanonicalPlanByMonths(1);
    assert.ok(m1);
    assert.equal(m1.price, 12.9);
    assert.equal(m1.priceCents, 1290);
    assert.equal(m1.currency, "BRL");
    assert.equal(m1.validityDays, 30);
    assert.equal(m1.id, "meuplantao-pro-1");

    const m3 = getCanonicalPlanByMonths(3);
    assert.ok(m3);
    assert.equal(m3.price, 38.7);
    assert.equal(m3.priceCents, 3870);
    assert.equal(m3.currency, "BRL");
    assert.equal(m3.validityDays, 90);
    assert.equal(m3.id, "meuplantao-pro-3");

    const m6 = getCanonicalPlanByMonths(6);
    assert.ok(m6);
    assert.equal(m6.price, 69.9);
    assert.equal(m6.priceCents, 6990);
    assert.equal(m6.currency, "BRL");
    assert.equal(m6.validityDays, 180);
    assert.equal(m6.id, "meuplantao-pro-6");

    const m12 = getCanonicalPlanByMonths(12);
    assert.ok(m12);
    assert.equal(m12.price, 129.9);
    assert.equal(m12.priceCents, 12990);
    assert.equal(m12.currency, "BRL");
    assert.equal(m12.validityDays, 365);
    assert.equal(m12.id, "meuplantao-pro-12");

    assert.equal(isSupportedMonths(1), true);
    assert.equal(isSupportedMonths(2), false);
    assert.equal(isSupportedMonths(3), true);
    assert.equal(isSupportedMonths(6), true);
    assert.equal(isSupportedMonths(12), true);
    assert.equal(isSupportedMonths(24), false);

    assert.equal(isSupportedPlanId("meuplantao-pro-1"), true);
    assert.equal(isSupportedPlanId("outro-produto"), false);

    assert.equal(toCents(12.9), 1290);
    assert.equal(toCents(129.9), 12990);
    assert.equal(toCents(0.01), 1);
  });

  // ─── 2. Cenários Adversários de Fraude e Rejeição ──────────────────────────
  test("2. Fraude: Pagamento de R$ 0,01 com months=12 NÃO concede Pro e vai para quarentena", async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) };
    const payment = {
      id: "fraud-001",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 0.01,
      external_reference: VALID_USER_ID,
      metadata: { user_id: VALID_USER_ID, months: 12 },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment);
    assert.equal(res.valid, false);
    assert.equal(res.quarantine, true);
    assert.equal(res.reason, "amount_mismatch");
    assert.equal(res.details?.paymentCents, 1);
    assert.equal(res.details?.expectedCents, 12990);
  });

  test("3. Moeda incorreta: Pagamento em USD NÃO concede Pro e vai para quarentena", async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) };
    const payment = {
      id: "usd-002",
      status: "approved",
      currency_id: "USD",
      transaction_amount: 12.9,
      external_reference: VALID_USER_ID,
      metadata: { user_id: VALID_USER_ID, months: 1 },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment);
    assert.equal(res.valid, false);
    assert.equal(res.quarantine, true);
    assert.equal(res.reason, "unsupported_currency");
    assert.equal(res.details?.currency, "USD");
  });

  test("4. Produto incorreto: Pagamento para outro item NÃO concede Pro e vai para quarentena", async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) };
    const payment = {
      id: "other-prod-003",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 12.9,
      external_reference: VALID_USER_ID,
      items: [{ id: "curso-medico-externo", unit_price: 12.9 }],
      metadata: { user_id: VALID_USER_ID, months: 1 },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment);
    assert.equal(res.valid, false);
    assert.equal(res.quarantine, true);
    assert.equal(res.reason, "unrecognized_product");
    assert.equal(res.details?.itemId, "curso-medico-externo");
  });

  test("5. Preço divergente: Pagamento de R$ 50,00 para plano de 1 mês (R$ 12,90) é colocado em quarentena", async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) };
    const payment = {
      id: "divergent-price-004",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 50.0,
      external_reference: VALID_USER_ID,
      metadata: { user_id: VALID_USER_ID, months: 1 },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment);
    assert.equal(res.valid, false);
    assert.equal(res.quarantine, true);
    assert.equal(res.reason, "amount_mismatch");
    assert.equal(res.details?.paymentCents, 5000);
    assert.equal(res.details?.expectedCents, 1290);
  });

  test("6. Ownership divergente: external_reference e metadata apontando para usuários distintos vai para quarentena", async () => {
    const admin = {};
    const payment = {
      id: "owner-diff-005",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 12.9,
      external_reference: VALID_USER_ID,
      metadata: { user_id: OTHER_USER_ID, months: 1 },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment);
    assert.equal(res.valid, false);
    assert.equal(res.quarantine, true);
    assert.equal(res.reason, "divergent_user_identifiers");
  });

  test("7. Ownership de terceiro em sessão autenticada retorna forbidden sem conceder Pro", async () => {
    const admin = {};
    const payment = {
      id: "other-user-006",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 12.9,
      external_reference: OTHER_USER_ID,
      metadata: { user_id: OTHER_USER_ID, months: 1 },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment, VALID_USER_ID);
    assert.equal(res.valid, false);
    assert.equal(res.forbidden, true);
  });

  // ─── 3. Cotação Persistida no Servidor (Proteção contra Mudança de Catálogo) ───
  test("8. Mudança futura de catálogo: pagamento com cotação persistida no checkout continua válido", async () => {
    const checkoutId = "33333333-3333-4333-8333-333333333333";
    const quotedCheckout = {
      id: checkoutId,
      user_id: VALID_USER_ID,
      plan_id: "meuplantao-pro-1",
      months: 1,
      validity_days: 30,
      amount: 12.9,
      amount_cents: 1290,
      currency: "BRL",
      catalog_version: "2026-v1",
      status: "pending",
    };

    const admin = {
      from: (table) => {
        if (table === "subscription_checkouts") {
          return {
            select: () => ({
              eq: (col1, val1) => ({
                eq: (col2, val2) => ({
                  maybeSingle: async () => ({
                    data: val1 === checkoutId && val2 === VALID_USER_ID ? quotedCheckout : null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    };

    // Pagamento referenciando o checkout_id legítimo
    const payment = {
      id: "valid-quoted-payment",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 12.9,
      external_reference: VALID_USER_ID,
      metadata: { user_id: VALID_USER_ID, checkout_id: checkoutId },
    };

    const res = await validatePaymentBeforeGrantingPro(admin, payment);
    assert.equal(res.valid, true);
    if (res.valid) {
      assert.equal(res.userId, VALID_USER_ID);
      assert.equal(res.planId, "meuplantao-pro-1");
      assert.equal(res.months, 1);
      assert.equal(res.validityDays, 30);
      assert.equal(res.amountCents, 1290);
      assert.equal(res.checkoutId, checkoutId);
      assert.equal(res.currency, "BRL");
    }
  });

  // ─── 4. Auditoria de Quarentena sem Perda de Histórico ─────────────────────
  test("9. quarantinePayment salva registro com motivo e dados da transação", async () => {
    let savedRow = null;
    const admin = {
      from: (table) => {
        if (table === "subscription_payments_quarantine") {
          return {
            insert: async (row) => {
              savedRow = row;
              return { error: null };
            },
          };
        }
        return {};
      },
    };

    await quarantinePayment(admin, {
      paymentId: "fraud-audit-123",
      userId: VALID_USER_ID,
      reason: "amount_mismatch",
      amount: 0.01,
      currency: "BRL",
      months: 12,
      rawPayload: { simulated: true },
    });

    assert.ok(savedRow);
    assert.equal(savedRow.mercadopago_payment_id, "fraud-audit-123");
    assert.equal(savedRow.user_id, VALID_USER_ID);
    assert.equal(savedRow.reason, "amount_mismatch");
    assert.equal(savedRow.amount, 0.01);
    assert.equal(savedRow.currency, "BRL");
    assert.equal(savedRow.status, "quarantined");
  });

  test("10. completeSubscriptionCheckout atualiza status para completed", async () => {
    let updatedStatus = null;
    let targetId = null;
    const admin = {
      from: (table) => {
        if (table === "subscription_checkouts") {
          return {
            update: (values) => ({
              eq: (col, val) => {
                updatedStatus = values.status;
                targetId = val;
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        return {};
      },
    };

    await completeSubscriptionCheckout(admin, "chk-123");
    assert.equal(targetId, "chk-123");
    assert.equal(updatedStatus, "completed");
  });

  // ─── 5. Integração com Webhook, Verify e Sync ──────────────────────────────
  test("11. Webhook com pagamento fraudado (R$ 0,01 para 12m) responde 200 quarantined sem chamar RPC", async () => {
    let rpcCalled = false;
    let quarantinedRow = null;
    globalThis.adminClient = {
      rpc: async () => {
        rpcCalled = true;
        return { data: null, error: null };
      },
      from: (table) => {
        if (table === "subscription_payments_quarantine") {
          return { insert: async (row) => { quarantinedRow = row; return { error: null }; } };
        }
        return {};
      },
    };

    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "pay-fraud-webhook",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 0.01,
      external_reference: VALID_USER_ID,
      metadata: { user_id: VALID_USER_ID, months: 12 },
    }), { status: 200 });

    const req = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: "pay-fraud-webhook" } }),
    });

    const res = await webhookRoute(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.received, true);
    assert.equal(json.processed, false);
    assert.equal(json.quarantined, true);
    assert.equal(json.reason, "amount_mismatch");
    assert.equal(rpcCalled, false, "RPC NÃO pode ser chamada para pagamento fraudado");
    assert.ok(quarantinedRow, "Deve salvar na tabela de quarentena");
  });

  test("12. Verify com preço divergente responde 422 quarantined sem chamar RPC", async () => {
    let rpcCalled = false;
    globalThis.adminClient = {
      rpc: async () => {
        rpcCalled = true;
        return { data: null, error: null };
      },
      from: () => ({ insert: async () => ({ error: null }) }),
    };
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: VALID_USER_ID } }, error: null }) },
    };

    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "pay-divergent-verify",
      status: "approved",
      currency_id: "BRL",
      transaction_amount: 0.05,
      external_reference: VALID_USER_ID,
      metadata: { user_id: VALID_USER_ID, months: 1 },
    }), { status: 200 });

    const req = {
      nextUrl: new URL("http://localhost/api/mercadopago/verify?payment_id=pay-divergent-verify"),
      cookies: { getAll: () => [] },
    };

    const res = await verifyRoute(req);
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.verified, false);
    assert.equal(json.quarantined, true);
    assert.equal(json.reason, "amount_mismatch");
    assert.equal(rpcCalled, false, "RPC NÃO pode ser chamada no verify divergente");
  });

  test("13. Sync com pagamento fraudado ignora sem ativar vigência", async () => {
    let rpcCalled = false;
    globalThis.adminClient = {
      rpc: async () => {
        rpcCalled = true;
        return { data: null, error: null };
      },
      from: () => ({
        insert: async () => ({ error: null }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
    };
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: VALID_USER_ID } }, error: null }) },
    };

    globalThis.fetch = async () => new Response(JSON.stringify({
      results: [
        {
          id: "sync-fraud",
          status: "approved",
          currency_id: "BRL",
          transaction_amount: 0.01,
          external_reference: VALID_USER_ID,
          metadata: { user_id: VALID_USER_ID, months: 6 },
        },
      ],
    }), { status: 200 });

    const res = await syncRoute(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.synced, true);
    assert.equal(json.newly_processed, 0, "Nenhum pagamento fraudado pode ser processado");
    assert.equal(json.total_payments, 0);
    assert.equal(rpcCalled, false);
  });
});
