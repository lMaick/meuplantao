import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test, { describe } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "config.ts")).href;
const paymentsUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "payments.ts")).href;
const webhookUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "webhook.ts")).href;
const trialUrl = pathToFileURL(path.join(ROOT, "src", "lib", "subscription", "trial.ts")).href;
const typesUrl = pathToFileURL(path.join(ROOT, "src", "lib", "subscription", "types.ts")).href;

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-test-token";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") return { url: configUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: paymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/webhook") return { url: webhookUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: trialUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/types") return { url: typesUrl, shortCircuit: true };
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

const { paymentBelongsToUser } = await import("../src/lib/mercadopago/config.ts");
const { processMercadoPagoPayment } = await import("../src/lib/mercadopago/payments.ts");
const { POST: checkout } = await import("../src/app/api/mercadopago/checkout/route.ts");
const { GET: verifyPayment } = await import("../src/app/api/mercadopago/verify/route.ts");
const { POST: syncRoute } = await import("../src/app/api/mercadopago/sync/route.ts");
const { POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Mock in-memory database simulation for Supabase */
function createMockSupabaseDatabase(options = {}) {
  const subscriptionPayments = new Map(); // mp_payment_id -> row
  const subscriptions = new Map(); // user_id -> row
  const userLocks = new Map();

  let rpcError = options.rpcError || null;
  let insertPaymentError = options.insertPaymentError || null;

  const adminClient = {
    setRpcError: (err) => { rpcError = err; },
    setInsertPaymentError: (err) => { insertPaymentError = err; },
    rpc: async (fnName, params) => {
      if (rpcError) {
        return { data: null, error: rpcError };
      }
      if (fnName === "process_mercadopago_subscription_payment") {
        const { p_payment_id, p_user_id, p_validity_days, p_months, p_amount, p_status } = params;
        const paymentId = String(p_payment_id).trim();

        // Simula pg_advisory_xact_lock(hashtext(p_user_id::text))
        const prevLock = userLocks.get(p_user_id) || Promise.resolve();
        let releaseLock;
        const currentLock = new Promise((resolve) => { releaseLock = resolve; });
        userLocks.set(p_user_id, prevLock.then(() => currentLock));
        await prevLock;

        try {
          // Pequeno yield assíncrono para garantir que concorrência real sem lock causaria race condition
          await new Promise((resolve) => setTimeout(resolve, 5));

          if (insertPaymentError) {
            return { data: null, error: insertPaymentError };
          }

          // Check if already processed
          if (subscriptionPayments.has(paymentId)) {
            const currentSub = subscriptions.get(p_user_id);
            const now = new Date();
            const isExpired = currentSub?.current_period_end ? new Date(currentSub.current_period_end) <= now : true;
            return {
              data: {
                already_processed: true,
                current_period_end: currentSub?.current_period_end || null,
                validity_days_added: 0,
                status: isExpired ? "expired" : (currentSub?.status || "active"),
              },
              error: null,
            };
          }

          // Insert new payment
          subscriptionPayments.set(paymentId, {
            mercadopago_payment_id: paymentId,
            user_id: p_user_id,
            months: p_months || 1,
            validity_days: p_validity_days || 30,
            amount: p_amount,
            status: p_status || "approved",
            processed_at: new Date().toISOString(),
          });

          // Calculate and extend validity
          const now = new Date();
          const currentSub = subscriptions.get(p_user_id);
          const currentEnd = currentSub?.current_period_end ? new Date(currentSub.current_period_end) : now;
          const start = currentEnd > now ? currentEnd : now;
          const newPeriodEnd = new Date(start);
          newPeriodEnd.setUTCDate(newPeriodEnd.getUTCDate() + (p_validity_days || 30));
          const newPeriodEndIso = newPeriodEnd.toISOString();

          subscriptions.set(p_user_id, {
            user_id: p_user_id,
            status: "active",
            current_period_end: newPeriodEndIso,
            updated_at: now.toISOString(),
          });

          return {
            data: {
              already_processed: false,
              current_period_end: newPeriodEndIso,
              validity_days_added: p_validity_days || 30,
              status: "active",
            },
            error: null,
          };
        } finally {
          releaseLock();
        }
      }
      return { data: null, error: new Error("RPC not found") };
    },
    from: (table) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: (_col, userId) => ({
              maybeSingle: async () => ({
                data: subscriptions.get(userId) || null,
                error: null,
              }),
            }),
          }),
          upsert: async (row) => {
            subscriptions.set(row.user_id, { ...subscriptions.get(row.user_id), ...row });
            return { error: null };
          },
        };
      }
      if (table === "subscription_payments") {
        return {
          select: () => ({
            eq: (_col, paymentId) => ({
              maybeSingle: async () => ({
                data: subscriptionPayments.get(paymentId) || null,
                error: null,
              }),
            }),
          }),
          insert: async (row) => {
            if (subscriptionPayments.has(row.mercadopago_payment_id)) {
              return { error: { code: "23505", message: "duplicate key value" } };
            }
            subscriptionPayments.set(row.mercadopago_payment_id, row);
            return { error: null };
          },
        };
      }
      return {};
    },
  };

  return { subscriptionPayments, subscriptions, adminClient };
}

describe("Auditoria PR #76 — Testes Reais de Renovação, Idempotência e Segurança", () => {
  test("1. Checkout: usuário active pode renovar e não recebe HTTP 409", async () => {
    const db = createMockSupabaseDatabase();
    db.subscriptions.set(USER_A, { user_id: USER_A, status: "active", current_period_end: "2026-11-01T00:00:00Z" });

    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A, email: "user@example.com" } }, error: null }) },
      from: db.adminClient.from,
    };

    let capturedBody = null;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ init_point: "https://mercadopago.test/renew-checkout" }), { status: 201 });
    };

    const req = new Request("http://localhost/api/mercadopago/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ months: 3 }),
    });

    const response = await checkout(req);
    assert.equal(response.status, 200, "Não deve retornar 409 para usuário ativo");
    const json = await response.json();
    assert.equal(json.init_point, "https://mercadopago.test/renew-checkout");
    assert.equal(capturedBody.metadata.is_renewal, true);
    assert.equal(capturedBody.metadata.months, 3);
    assert.equal(capturedBody.external_reference, USER_A);
  });

  test("2. Verify idempotente: payment_id 123 adiciona +90d na 1ª vez e +0d na 2ª vez", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
    };

    globalThis.fetch = async () => new Response(
      JSON.stringify({
        id: "123",
        status: "approved",
        external_reference: `${USER_A}#3`,
        metadata: { user_id: USER_A, months: 3 },
      }),
      { status: 200 },
    );

    const verifyReq = {
      nextUrl: new URL("http://localhost/api/mercadopago/verify?payment_id=123"),
      cookies: { getAll: () => [] },
    };

    // 1ª execução: adiciona 90 dias
    const res1 = await verifyPayment(verifyReq);
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.equal(json1.verified, true);
    assert.equal(json1.already_processed, false);
    const end1 = new Date(json1.current_period_end).getTime();
    const diffDays1 = Math.round((end1 - Date.now()) / MS_PER_DAY);
    assert.ok(diffDays1 >= 89 && diffDays1 <= 91, `esperado ~90 dias, obtido ${diffDays1}`);

    // 2ª execução do mesmo payment_id: não adiciona vigência extra
    const res2 = await verifyPayment(verifyReq);
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.verified, true);
    assert.equal(json2.already_processed, true);
    assert.equal(json2.current_period_end, json1.current_period_end, "current_period_end deve ser idêntico");
  });

  test("3. Webhook idempotente: mesmo payment_id recebido 2x adiciona vigência apenas 1x", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.__mockWebhookSecret = null;

    globalThis.fetch = async () => new Response(
      JSON.stringify({
        id: "webhook-pay-1",
        status: "approved",
        external_reference: `${USER_A}#6`,
        metadata: { user_id: USER_A, months: 6 },
      }),
      { status: 200 },
    );

    const webhookReq = () => new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payment", data: { id: "webhook-pay-1" } }),
    });

    // 1ª entrega webhook
    const res1 = await webhookPost(webhookReq());
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.equal(json1.processed, true);
    assert.equal(json1.already_processed, false);
    const end1 = json1.current_period_end;

    // 2ª entrega webhook do mesmo payment
    const res2 = await webhookPost(webhookReq());
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.processed, true);
    assert.equal(json2.already_processed, true);
    assert.equal(json2.current_period_end, end1, "current_period_end não deve se alterar no reprocessamento");
  });

  test("4. Sync idempotente: executar sync várias vezes mantém current_period_end inalterado sem pagamentos novos", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
      from: db.adminClient.from,
    };

    globalThis.fetch = async () => new Response(
      JSON.stringify({
        results: [
          { id: "sync-1", status: "approved", external_reference: `${USER_A}#1`, metadata: { user_id: USER_A, months: 1 } },
        ],
      }),
      { status: 200 },
    );

    const syncReq = () => new Request("http://localhost/api/mercadopago/sync", { method: "POST" });

    // 1ª sincronização
    const res1 = await syncRoute(syncReq());
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.equal(json1.synced, true);
    assert.equal(json1.newly_processed, 1);
    const end1 = json1.current_period_end;

    // 2ª sincronização com os mesmos pagamentos
    const res2 = await syncRoute(syncReq());
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.synced, true);
    assert.equal(json2.newly_processed, 0, "Nenhum pagamento novo deve ser processado");
    assert.equal(json2.current_period_end, end1, "Vigência deve permanecer exatamente a mesma");
  });

  test("5. Dois pagamentos legítimos: 90 dias + 180 dias = 270 dias cumulativos", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
      from: db.adminClient.from,
    };

    globalThis.fetch = async () => new Response(
      JSON.stringify({
        results: [
          { id: "pay-trimestral", status: "approved", external_reference: `${USER_A}#3`, metadata: { user_id: USER_A, months: 3 } },
          { id: "pay-semestral", status: "approved", external_reference: `${USER_A}#6`, metadata: { user_id: USER_A, months: 6 } },
        ],
      }),
      { status: 200 },
    );

    const response = await syncRoute(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.synced, true);
    assert.equal(json.newly_processed, 2);

    const totalDays = Math.round((new Date(json.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(totalDays >= 268 && totalDays <= 272, `esperado ~270 dias cumulativos, obtido ${totalDays}`);
  });

  test("6. Segurança estrita de referências em paymentBelongsToUser", () => {
    // 6.1 Nenhuma identificação presente -> rejeitado
    assert.equal(paymentBelongsToUser({}, USER_A), false);
    assert.equal(paymentBelongsToUser({ external_reference: "" }, USER_A), false);
    assert.equal(paymentBelongsToUser({ metadata: {} }, USER_A), false);

    // 6.2 Somente uma identificação -> validada normalmente
    assert.equal(paymentBelongsToUser({ external_reference: USER_A }, USER_A), true);
    assert.equal(paymentBelongsToUser({ external_reference: `${USER_A}#12` }, USER_A), true);
    assert.equal(paymentBelongsToUser({ metadata: { user_id: USER_A } }, USER_A), true);
    assert.equal(paymentBelongsToUser({ metadata: { userId: USER_A } }, USER_A), true);

    // 6.3 Identificação de outro usuário -> rejeitado
    assert.equal(paymentBelongsToUser({ external_reference: USER_B }, USER_A), false);
    assert.equal(paymentBelongsToUser({ metadata: { user_id: USER_B } }, USER_A), false);

    // 6.4 Múltiplas identificações coerentes -> aprovado
    assert.equal(paymentBelongsToUser({ external_reference: USER_A, metadata: { user_id: USER_A } }, USER_A), true);
    assert.equal(paymentBelongsToUser({ external_reference: `${USER_A}#3`, metadata: { user_id: USER_A } }, USER_A), true);

    // 6.5 Múltiplas identificações divergentes -> REJEITADO (Regra estrita)
    assert.equal(paymentBelongsToUser({ external_reference: USER_A, metadata: { user_id: USER_B } }, USER_A), false);
    assert.equal(paymentBelongsToUser({ external_reference: `${USER_A}#6`, metadata: { user_id: USER_B } }, USER_A), false);
    assert.equal(paymentBelongsToUser({ external_reference: USER_B, metadata: { user_id: USER_A } }, USER_A), false);
  });

  test("7. Fail-Closed: RPC falha -> lança erro, nenhuma alteração em subscriptions e sem fallback direto", async () => {
    const db = createMockSupabaseDatabase({
      rpcError: { code: "50000", message: "Database connection timeout in RPC" },
    });

    // Tentativa direta com processMercadoPagoPayment
    await assert.rejects(
      async () => {
        await processMercadoPagoPayment(db.adminClient, {
          paymentId: "pay-fail-1",
          userId: USER_A,
          months: 3,
          validityDays: 90,
        });
      },
      /Falha no processamento atomico do pagamento/i,
      "processMercadoPagoPayment deve lançar erro e abortar imediatamente",
    );

    // Garante que subscriptions permaneceu completamente vazia e intocada (sem fallback direto aplicando dias)
    assert.equal(db.subscriptions.get(USER_A), undefined, "Assinatura NUNCA deve ser alterada se a RPC falhar");
    assert.equal(db.subscriptionPayments.size, 0, "Nenhum payment_id deve ser salvo");

    // Tentativa via rota /api/mercadopago/verify
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
    };
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        id: "pay-fail-1",
        status: "approved",
        external_reference: USER_A,
        metadata: { user_id: USER_A, months: 3 },
      }),
      { status: 200 },
    );

    const verifyReq = {
      nextUrl: new URL("http://localhost/api/mercadopago/verify?payment_id=pay-fail-1"),
      cookies: { getAll: () => [] },
    };

    const res = await verifyPayment(verifyReq);
    assert.equal(res.status, 500, "Verify deve retornar 500 se o processamento atômico falhar");
    assert.equal(db.subscriptions.get(USER_A), undefined, "Assinatura permanece intocada");
  });

  test("8. Falha ao registrar payment_id na tabela -> NÃO atualizar current_period_end", async () => {
    const db = createMockSupabaseDatabase({
      insertPaymentError: { code: "42P01", message: "subscription_payments table locked" },
    });

    await assert.rejects(
      async () => {
        await processMercadoPagoPayment(db.adminClient, {
          paymentId: "pay-fail-insert",
          userId: USER_A,
          months: 3,
          validityDays: 90,
        });
      },
      /Falha no processamento atomico do pagamento/i,
    );

    assert.equal(db.subscriptions.get(USER_A), undefined, "Assinatura não pode ser criada nem estendida");
  });

  test("9. Concorrência com dois pagamentos diferentes: A (+90d) e B (+180d) simultâneos sem assinatura prévia", async () => {
    const db = createMockSupabaseDatabase();

    // Usuário novo sem assinatura prévia no banco
    assert.equal(db.subscriptions.get(USER_A), undefined);

    // Executa simultaneamente A e B via Promise.all
    const [resA, resB] = await Promise.all([
      processMercadoPagoPayment(db.adminClient, {
        paymentId: "concurrent-pay-A",
        userId: USER_A,
        months: 3,
        validityDays: 90,
      }),
      processMercadoPagoPayment(db.adminClient, {
        paymentId: "concurrent-pay-B",
        userId: USER_A,
        months: 6,
        validityDays: 180,
      }),
    ]);

    assert.equal(resA.already_processed, false);
    assert.equal(resB.already_processed, false);

    // Ambos os payment_ids devem estar registrados
    assert.equal(db.subscriptionPayments.size, 2);
    assert.ok(db.subscriptionPayments.has("concurrent-pay-A"));
    assert.ok(db.subscriptionPayments.has("concurrent-pay-B"));

    // A vigência final deve ser a soma dos dois períodos (+270 dias)
    const sub = db.subscriptions.get(USER_A);
    assert.ok(sub, "Assinatura deve existir");
    assert.equal(sub.status, "active");

    const totalDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(
      totalDays >= 268 && totalDays <= 272,
      `esperado ~270 dias acumulados (+90 + 180), obtido ${totalDays}`,
    );
  });

  test("10. Concorrência com o mesmo pagamento (A e A simultâneos)", async () => {
    const db = createMockSupabaseDatabase();

    // Executa duas chamadas simultâneas com exatamente o mesmo paymentId
    const [res1, res2] = await Promise.all([
      processMercadoPagoPayment(db.adminClient, {
        paymentId: "same-payment-123",
        userId: USER_A,
        months: 3,
        validityDays: 90,
      }),
      processMercadoPagoPayment(db.adminClient, {
        paymentId: "same-payment-123",
        userId: USER_A,
        months: 3,
        validityDays: 90,
      }),
    ]);

    // Exatamente uma deve ser inédita e a outra detectada como já processada
    const newlyProcessed = [res1, res2].filter((r) => !r.already_processed);
    const alreadyProcessed = [res1, res2].filter((r) => r.already_processed);

    assert.equal(newlyProcessed.length, 1, "Apenas uma chamada deve processar como nova");
    assert.equal(alreadyProcessed.length, 1, "A outra chamada deve ser identificada como already_processed");

    // Apenas 1 registro salvo na tabela de pagamentos
    assert.equal(db.subscriptionPayments.size, 1);

    // Vigência acumulada deve ser de apenas +90 dias (nunca +180 dias)
    const sub = db.subscriptions.get(USER_A);
    const totalDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(
      totalDays >= 89 && totalDays <= 91,
      `esperado ~90 dias (sem duplicação), obtido ${totalDays}`,
    );
  });

  test("11. Pagamento já processado com vigência expirada NÃO retorna 'active' artificialmente", async () => {
    const db = createMockSupabaseDatabase();

    // 1º: processa pagamento inicial
    await processMercadoPagoPayment(db.adminClient, {
      paymentId: "old-pay-expired",
      userId: USER_A,
      months: 1,
      validityDays: 30,
    });

    // Simula passagem do tempo: no banco real subscriptions.status mantém "active", mas current_period_end expirou há 10 dias
    const pastDate = new Date(Date.now() - 10 * MS_PER_DAY).toISOString();
    db.subscriptions.set(USER_A, {
      user_id: USER_A,
      status: "active",
      current_period_end: pastDate,
      updated_at: pastDate,
    });

    // 2º: consulta novamente o mesmo paymentId antigo
    const recheckResult = await processMercadoPagoPayment(db.adminClient, {
      paymentId: "old-pay-expired",
      userId: USER_A,
      months: 1,
      validityDays: 30,
    });

    assert.equal(recheckResult.already_processed, true, "Deve indicar que já foi processado");
    assert.equal(recheckResult.validity_days_added, 0, "Nenhum dia novo deve ser adicionado");
    assert.equal(recheckResult.current_period_end, pastDate, "Data de expiração não é alterada");
    assert.notEqual(recheckResult.status, "active", "NÃO deve retornar status 'active' para assinatura expirada");
    assert.equal(recheckResult.status, "expired");
  });

  test("12. Sync encontra pagamentos salvos com external_reference = userId", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
      from: db.adminClient.from,
    };

    let requestedSearchUrl = null;
    globalThis.fetch = async (url) => {
      requestedSearchUrl = url;
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "sync-clean-ref",
              status: "approved",
              external_reference: USER_A,
              metadata: { user_id: USER_A, months: 6 },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const res = await syncRoute(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.synced, true);
    assert.equal(json.newly_processed, 1);
    assert.ok(requestedSearchUrl.includes(`external_reference=${encodeURIComponent(USER_A)}`));

    const totalDays = Math.round((new Date(json.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(totalDays >= 178 && totalDays <= 182, `esperado ~180 dias, obtido ${totalDays}`);
  });

  test("13. Sync retorna status: 'expired' quando vigência venceu, mesmo com status = 'active' no banco", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
      from: db.adminClient.from,
    };

    // Assinatura no banco com status='active', mas current_period_end no passado (ontem)
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.subscriptions.set(USER_A, {
      user_id: USER_A,
      status: "active",
      current_period_end: pastDate,
      updated_at: pastDate,
    });

    // Mock do Mercado Pago retornando o pagamento antigo já existente
    db.subscriptionPayments.set("old-pay-123", {
      mercadopago_payment_id: "old-pay-123",
      user_id: USER_A,
      months: 1,
      validity_days: 30,
      amount: 49.9,
      status: "approved",
      processed_at: pastDate,
    });

    globalThis.fetch = async () => new Response(
      JSON.stringify({
        results: [
          {
            id: "old-pay-123",
            status: "approved",
            external_reference: USER_A,
            metadata: { user_id: USER_A, months: 1 },
            date_created: pastDate,
            date_approved: pastDate,
          },
        ],
      }),
      { status: 200 },
    );

    const res = await syncRoute(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.synced, true);
    assert.equal(json.newly_processed, 0, "Pagamento antigo já estava processado");
    assert.equal(json.current_period_end, pastDate, "Vigência expirada mantida");
    assert.equal(json.status, "expired", "Status DEVE ser 'expired', mesmo com status='active' no banco");
  });

  test("14. Sync retorna status: 'expired' quando nenhum pagamento aprovado é encontrado e vigência venceu", async () => {
    const db = createMockSupabaseDatabase();
    globalThis.adminClient = db.adminClient;
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
      from: db.adminClient.from,
    };

    // Assinatura no banco com status='active', mas current_period_end no passado (ontem)
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.subscriptions.set(USER_A, {
      user_id: USER_A,
      status: "active",
      current_period_end: pastDate,
      updated_at: pastDate,
    });

    // Mercado Pago retorna 0 pagamentos aprovados
    globalThis.fetch = async () => new Response(
      JSON.stringify({ results: [] }),
      { status: 200 },
    );

    const res = await syncRoute(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.synced, false);
    assert.equal(json.current_period_end, pastDate);
    assert.equal(json.status, "expired", "Status DEVE ser 'expired' mesmo quando nenhum pagamento é encontrado");
  });
});

