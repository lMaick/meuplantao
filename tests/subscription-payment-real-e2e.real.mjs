/**
 * MeuPlantão — Subscription Payment Real PostgreSQL E2E
 *
 * Valida a semântica real da RPC process_mercadopago_subscription_payment
 * diretamente no PostgreSQL (Supabase local). Sem mocks — cada cenário
 * conecta ao banco real via pg driver e REST API com service_role.
 *
 * Variáveis de ambiente obrigatórias:
 *   RUN_REAL_E2E=1                      → habilita a suíte
 *   DATABASE_URL                         → URL de conexão direta ao PostgreSQL
 *   NEXT_PUBLIC_SUPABASE_URL             → URL do Supabase local (API REST)
 *   SUPABASE_SERVICE_ROLE_KEY            → chave service_role (nunca versionada)
 *
 * Uso:
 *   RUN_REAL_E2E=1 \
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node --experimental-strip-types --test tests/subscription-payment-real-e2e.real.mjs
 *
 * CI: job "Supabase Subscription Payment E2E" em .github/workflows/ci.yml
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// ─── Gate de segurança ───────────────────────────────────────────────────────
// Verificação antes do import dinâmico de 'pg' (que pode não estar disponível
// em ambientes sem npm ci). O throw aqui aborta a avaliação do módulo antes
// de alcançar o await import("pg") abaixo.

if (process.env.RUN_REAL_E2E !== "1") {
  throw new Error(
    "Suíte real bloqueada: defina RUN_REAL_E2E=1 e aponte para um Supabase de teste. " +
    "Nunca execute contra produção.",
  );
}

const REQUIRED_VARS = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const MISSING_VARS = REQUIRED_VARS.filter((v) => !process.env[v]);
if (MISSING_VARS.length > 0) {
  throw new Error(`E2E real sem configuração: ${MISSING_VARS.join(", ")}`);
}

// pg é uma dependência de produção listada em package.json.
// Import dinâmico garante que o gate falha antes de tentar resolver o módulo.
const { default: pg } = await import("pg");
const { Client: PgClient } = pg;

// ─── Constantes de conexão ───────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL;
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cria e retorna um PgClient já conectado. */
async function pgConnect() {
  const client = new PgClient({ connectionString: DB_URL });
  await client.connect();
  return client;
}

/** Executa query no PostgreSQL e retorna rows. */
async function pgQuery(sql, params = []) {
  const client = await pgConnect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Chama process_mercadopago_subscription_payment via REST API com service_role.
 * A função é SECURITY DEFINER e só pode ser chamada por service_role.
 * Contrato MAI-147: exige 7 parâmetros (incluindo p_checkout_id).
 */
async function callRpc(params) {
  const url = `${API_URL}/rest/v1/rpc/process_mercadopago_subscription_payment`;
  const checkoutId = params.checkout_id !== undefined ? params.checkout_id : params.p_checkout_id;
  const body = {
    p_payment_id: params.payment_id ?? params.p_payment_id,
    p_user_id: params.user_id ?? params.p_user_id,
    p_months: params.months ?? params.p_months ?? 1,
    p_validity_days: params.validity_days ?? params.p_validity_days ?? 30,
    p_amount: params.amount ?? params.p_amount ?? 49.9,
    p_status: params.status ?? params.p_status ?? "approved",
    // MAI-147 fail-closed (migration 29400000): cotacao obrigatoria (7 parametros).
    ...(checkoutId !== undefined ? { p_checkout_id: checkoutId } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Gera um UUID v4-like fixo para testes a partir de um sufixo alfanumérico.
 * Garante formato válido de UUID para o tipo uuid do PostgreSQL.
 * Cada sufixo distinto gera um UUID distinto e estável para depuração.
 */
function fixtureUUID(suffix) {
  // Mapeia os sufixos usados nos testes para hex puro (12 chars hex = 48 bits)
  const suffixMap = {
    "e201":  "000000000201",
    "e202":  "000000000202",
    "e203":  "000000000203",
    "e204":  "000000000204",
    "e205":  "000000000205",
    "e206":  "000000000206",
    "e207a": "0000000207a0",
    "e207b": "0000000207b0",
    "e208":  "000000000208",
    "e209":  "000000000209",
  };
  const hex = suffixMap[suffix] ?? suffix.padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

/**
 * Cria usuário de teste no auth.users via SQL direto (fixture efêmero).
 * O usuário tem 20 dias de vida → trial (14 dias) já expirou, garantindo
 * que a assinatura verificada vem de subscriptions, não do trial.
 */
async function createTestUser(suffix) {
  const userId = fixtureUUID(suffix);
  const email = `sub-pay-e2e-${suffix}@test.local`;

  await pgQuery(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'fixture-hash', now(), now() - interval '20 days', now())
     ON CONFLICT (id) DO NOTHING`,
    [userId, email],
  );

  return userId;
}

/** Lê a linha de subscriptions para um user_id. */
async function getSubscription(userId) {
  const rows = await pgQuery(
    "SELECT * FROM public.subscriptions WHERE user_id = $1",
    [userId],
  );
  return rows[0] ?? null;
}

/** Conta linhas em subscription_payments para um user_id. */
async function countPayments(userId) {
  const rows = await pgQuery(
    "SELECT count(*)::int AS n FROM public.subscription_payments WHERE user_id = $1",
    [userId],
  );
  return rows[0].n;
}

/** Lê a linha de subscription_payments pelo mercadopago_payment_id. */
async function getPaymentRow(paymentId) {
  const rows = await pgQuery(
    "SELECT * FROM public.subscription_payments WHERE mercadopago_payment_id = $1",
    [paymentId],
  );
  return rows[0] ?? null;
}

/** Lê a linha de subscription_checkouts pelo id. */
async function getCheckoutRow(checkoutId) {
  const rows = await pgQuery(
    "SELECT * FROM public.subscription_checkouts WHERE id = $1",
    [checkoutId],
  );
  return rows[0] ?? null;
}

/** Cria uma cotação válida de teste em subscription_checkouts. */
async function createTestCheckout(userId, opts = {}) {
  const checkoutId = opts.id ?? randomUUID();
  const months = opts.months ?? 1;
  const validityDays = opts.validity_days ?? 30;
  const amount = opts.amount ?? 49.9;
  const amountCents = Math.round(amount * 100);
  const status = opts.status ?? "pending";
  const planId = opts.plan_id ?? `pro-${months}m`;
  const isExpired = Boolean(opts.expired);

  const query = isExpired
    ? `INSERT INTO public.subscription_checkouts (
         id, user_id, plan_id, months, validity_days, amount, amount_cents, currency, catalog_version, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', '2026-v1', $8, now() - interval '1 hour')
       RETURNING id`
    : `INSERT INTO public.subscription_checkouts (
         id, user_id, plan_id, months, validity_days, amount, amount_cents, currency, catalog_version, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', '2026-v1', $8, now() + interval '3 days')
       RETURNING id`;

  const rows = await pgQuery(query, [
    checkoutId,
    userId,
    planId,
    months,
    validityDays,
    amount,
    amountCents,
    status,
  ]);
  return rows[0].id;
}

/** Limpa fixtures ao final de cada teste (delete cascade via auth.users). */
async function cleanupUser(...userIds) {
  for (const userId of userIds) {
    try {
      // subscription_payments, subscription_checkouts e subscriptions têm FK -> auth.users ON DELETE CASCADE
      await pgQuery("DELETE FROM auth.users WHERE id = $1", [userId]);
    } catch {
      // Silencia erros de cleanup para não ocultar a falha real do teste
    }
  }
}

// ─── Testes ──────────────────────────────────────────────────────────────────

test("1. payment_id novo → cria entrada em subscription_payments e adiciona vigência exatamente uma vez", async () => {
  const userId = await createTestUser("e201");
  const checkoutId = await createTestCheckout(userId, { validity_days: 30, months: 1, amount: 49.9 });
  const paymentId = `real-e2e-test1-${Date.now()}`;
  try {
    const res = await callRpc({ payment_id: paymentId, user_id: userId, validity_days: 30, checkout_id: checkoutId });
    assert.ok(res.ok, `RPC falhou: HTTP ${res.status} — ${JSON.stringify(res.data)}`);

    const result = res.data;
    assert.equal(result.already_processed, false, "Deve ser primeira vez");
    assert.equal(result.validity_days_added, 30, "Deve ter adicionado 30 dias");
    assert.ok(result.current_period_end, "Deve ter current_period_end");
    assert.equal(result.status, "active");

    // Invariante PostgreSQL: exatamente 1 linha em subscription_payments
    const count = await countPayments(userId);
    assert.equal(count, 1, "Deve existir exatamente 1 registro em subscription_payments");

    // Invariante: a linha criada tem os campos corretos e vinculada ao checkout
    const row = await getPaymentRow(paymentId);
    assert.ok(row, "Linha deve existir em subscription_payments");
    assert.equal(row.mercadopago_payment_id, paymentId);
    assert.equal(row.user_id, userId);
    assert.equal(row.checkout_id, checkoutId);
    assert.equal(Number(row.validity_days), 30);
    assert.equal(Number(row.months), 1);
    assert.equal(row.status, "approved");
    assert.ok(row.processed_at, "processed_at deve estar preenchido");

    // Invariante: cotação consumida e marcada como completed
    const chk = await getCheckoutRow(checkoutId);
    assert.ok(chk, "Linha deve existir em subscription_checkouts");
    assert.equal(chk.status, "completed");
    assert.equal(chk.completed_payment_id, paymentId);
    assert.ok(chk.completed_at, "completed_at deve estar preenchido");

    // Invariante: current_period_end em subscriptions é ~30 dias no futuro
    const sub = await getSubscription(userId);
    assert.ok(sub, "Assinatura deve existir");
    assert.equal(sub.status, "active");
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(diffDays >= 29 && diffDays <= 31, `Esperado ~30 dias, obtido ${diffDays}`);
  } finally {
    await cleanupUser(userId);
  }
});

test("2. mesmo payment_id duas vezes → segunda chamada retorna already_processed e current_period_end não muda", async () => {
  const userId = await createTestUser("e202");
  const checkoutId = await createTestCheckout(userId, { validity_days: 30, months: 1 });
  const paymentId = `real-e2e-test2-${Date.now()}`;
  try {
    // Primeira chamada
    const res1 = await callRpc({ payment_id: paymentId, user_id: userId, validity_days: 30, checkout_id: checkoutId });
    assert.ok(res1.ok, `1ª RPC falhou: HTTP ${res1.status} ${JSON.stringify(res1.data)}`);
    assert.equal(res1.data.already_processed, false);
    const periodEnd1 = res1.data.current_period_end;

    // Segunda chamada — mesmo payment_id e mesma cotação
    const res2 = await callRpc({ payment_id: paymentId, user_id: userId, validity_days: 30, checkout_id: checkoutId });
    assert.ok(res2.ok, `2ª RPC falhou: HTTP ${res2.status} ${JSON.stringify(res2.data)}`);
    assert.equal(res2.data.already_processed, true, "Segunda chamada deve ser already_processed");
    assert.equal(res2.data.validity_days_added, 0, "Nenhum dia deve ser adicionado novamente");
    assert.equal(
      res2.data.current_period_end,
      periodEnd1,
      "current_period_end NÃO pode mudar no reprocessamento",
    );

    // Sub-cenário: reenvio com cotação divergente deve falhar com 23505 (consistência 1:1)
    const checkoutDivergent = await createTestCheckout(userId, { validity_days: 30, months: 1 });
    const resDiv = await callRpc({ payment_id: paymentId, user_id: userId, validity_days: 30, checkout_id: checkoutDivergent });
    assert.equal(resDiv.ok, false, "Reenvio com cotação divergente deve ser rejeitado");
    const errDiv = resDiv.data ?? {};
    assert.ok(
      String(errDiv.code ?? "").includes("23505") ||
      String(errDiv.message ?? "").toLowerCase().includes("divergente"),
      `Esperado erro de cotação divergente (23505/divergente), obtido: ${JSON.stringify(resDiv.data)}`,
    );
    assert.ok(
      resDiv.status === 400 || resDiv.status === 409,
      `Esperado status HTTP 400 ou 409, obtido HTTP ${resDiv.status}`,
    );

    // Invariante PostgreSQL: UNIQUE constraint → ainda só 1 linha
    const count = await countPayments(userId);
    assert.equal(count, 1, "UNIQUE mercadopago_payment_id: não deve duplicar");

    // Invariante: current_period_end no banco não foi alterado
    const sub = await getSubscription(userId);
    assert.equal(
      new Date(sub.current_period_end).toISOString(),
      new Date(periodEnd1).toISOString(),
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("3. pagamentos A e B distintos → ambos adicionados com vigências acumuladas", async () => {
  const userId = await createTestUser("e203");
  const checkoutA = await createTestCheckout(userId, { validity_days: 30, months: 1 });
  const checkoutB = await createTestCheckout(userId, { validity_days: 90, months: 3, amount: 149.9 });
  const paymentA = `real-e2e-test3-A-${Date.now()}`;
  const paymentB = `real-e2e-test3-B-${Date.now()}`;
  try {
    // Pagamento A: 30 dias com checkoutA
    const resA = await callRpc({ payment_id: paymentA, user_id: userId, validity_days: 30, checkout_id: checkoutA });
    assert.ok(resA.ok, `RPC A falhou: HTTP ${resA.status} ${JSON.stringify(resA.data)}`);
    assert.equal(resA.data.already_processed, false);

    // Pagamento B: 90 dias com checkoutB
    const resB = await callRpc({ payment_id: paymentB, user_id: userId, validity_days: 90, months: 3, amount: 149.9, checkout_id: checkoutB });
    assert.ok(resB.ok, `RPC B falhou: HTTP ${resB.status} ${JSON.stringify(resB.data)}`);
    assert.equal(resB.data.already_processed, false);

    // Invariante: 2 linhas em subscription_payments
    const count = await countPayments(userId);
    assert.equal(count, 2, "Dois payment_ids distintos devem gerar 2 linhas");

    // Invariante: ambas as linhas existem individualmente
    assert.ok(await getPaymentRow(paymentA), "Linha do pagamento A deve existir");
    assert.ok(await getPaymentRow(paymentB), "Linha do pagamento B deve existir");

    // Invariante: vigência acumulada ~120 dias (30+90)
    const sub = await getSubscription(userId);
    assert.ok(sub, "Assinatura deve existir");
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(
      diffDays >= 118 && diffDays <= 122,
      `Esperado ~120 dias acumulados (30+90), obtido ${diffDays}`,
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("4. pagamentos A e B concorrentes → vigência final é soma das duas extensões (pg_advisory_xact_lock serializa)", async () => {
  const userId = await createTestUser("e204");
  const checkoutA = await createTestCheckout(userId, { validity_days: 90, months: 3, amount: 149.9 });
  const checkoutB = await createTestCheckout(userId, { validity_days: 180, months: 6, amount: 289.9 });
  const paymentA = `real-e2e-test4-A-${Date.now()}`;
  const paymentB = `real-e2e-test4-B-${Date.now()}`;
  try {
    // Disparo simultâneo de dois pagamentos distintos via Promise.all
    const [resA, resB] = await Promise.all([
      callRpc({ payment_id: paymentA, user_id: userId, validity_days: 90, months: 3, amount: 149.9, checkout_id: checkoutA }),
      callRpc({ payment_id: paymentB, user_id: userId, validity_days: 180, months: 6, amount: 289.9, checkout_id: checkoutB }),
    ]);

    // Ambos devem ter sucesso (pg_advisory_xact_lock serializa internamente)
    assert.ok(resA.ok, `RPC A concorrente falhou: HTTP ${resA.status} ${JSON.stringify(resA.data)}`);
    assert.ok(resB.ok, `RPC B concorrente falhou: HTTP ${resB.status} ${JSON.stringify(resB.data)}`);
    assert.equal(resA.data.already_processed, false, "Pagamento A deve ser novo");
    assert.equal(resB.data.already_processed, false, "Pagamento B deve ser novo");

    // Invariante: exatamente 2 linhas em subscription_payments
    const count = await countPayments(userId);
    assert.equal(count, 2, "Dois pagamentos concorrentes distintos: 2 linhas esperadas");

    // Invariante: vigência final = ~270 dias (90 + 180 serializados pelo lock)
    const sub = await getSubscription(userId);
    assert.ok(sub, "Assinatura deve existir");
    assert.equal(sub.status, "active");
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(
      diffDays >= 268 && diffDays <= 272,
      `Esperado ~270 dias (90+180) serializados pelo lock, obtido ${diffDays}`,
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("5. mesmo payment_id concorrente → apenas uma extensão aplicada (UNIQUE + advisory lock garantem)", async () => {
  const userId = await createTestUser("e205");
  const checkoutId = await createTestCheckout(userId, { validity_days: 90, months: 3, amount: 149.9 });
  const paymentId = `real-e2e-test5-${Date.now()}`;
  try {
    // Dois disparos simultâneos do MESMO payment_id com o MESMO checkout_id
    const [res1, res2] = await Promise.all([
      callRpc({ payment_id: paymentId, user_id: userId, validity_days: 90, months: 3, amount: 149.9, checkout_id: checkoutId }),
      callRpc({ payment_id: paymentId, user_id: userId, validity_days: 90, months: 3, amount: 149.9, checkout_id: checkoutId }),
    ]);

    // Ambas as chamadas devem responder com HTTP 200
    assert.ok(res1.ok, `1ª RPC falhou: HTTP ${res1.status} ${JSON.stringify(res1.data)}`);
    assert.ok(res2.ok, `2ª RPC falhou: HTTP ${res2.status} ${JSON.stringify(res2.data)}`);

    const results = [res1.data, res2.data];

    // Exatamente um deve ser "novo" e o outro "already_processed"
    const newOnes = results.filter((r) => !r.already_processed);
    const duplicates = results.filter((r) => r.already_processed);
    assert.equal(newOnes.length, 1, "Exatamente uma chamada deve processar como nova");
    assert.equal(duplicates.length, 1, "A outra deve retornar already_processed");

    // Invariante PostgreSQL: UNIQUE constraint → exatamente 1 linha
    const count = await countPayments(userId);
    assert.equal(count, 1, "UNIQUE mercadopago_payment_id: só 1 linha mesmo com 2 chamadas simultâneas");

    // Invariante: vigência adicionada = apenas 90 dias (nunca 180)
    const sub = await getSubscription(userId);
    assert.ok(sub, "Assinatura deve existir");
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(
      diffDays >= 89 && diffDays <= 91,
      `Esperado ~90 dias (sem duplicação), obtido ${diffDays}`,
    );

    // Sub-cenário de concorrência: 2 pagamentos distintos disputando a MESMA cotação (claim CAS atômico)
    const sharedCheckout = await createTestCheckout(userId, { validity_days: 30, months: 1 });
    const paymentClaimA = `real-e2e-test5-claimA-${Date.now()}`;
    const paymentClaimB = `real-e2e-test5-claimB-${Date.now()}`;
    const [resClaimA, resClaimB] = await Promise.all([
      callRpc({ payment_id: paymentClaimA, user_id: userId, validity_days: 30, checkout_id: sharedCheckout }),
      callRpc({ payment_id: paymentClaimB, user_id: userId, validity_days: 30, checkout_id: sharedCheckout }),
    ]);

    const claims = [resClaimA, resClaimB];
    const successes = claims.filter((c) => c.ok);
    const conflicts = claims.filter((c) => !c.ok);
    assert.equal(successes.length, 1, "Exatamente uma chamada concorrente deve consumir a cotação");
    assert.equal(conflicts.length, 1, "A outra chamada concorrente pela mesma cotação deve falhar");
    const conflictErr = conflicts[0].data ?? {};
    assert.ok(
      String(conflictErr.code ?? "").includes("23505") ||
      String(conflictErr.message ?? "").toLowerCase().includes("consumida"),
      `Concorrência de cotação deve retornar 23505/consumida, obtido: ${JSON.stringify(conflicts[0].data)}`,
    );
    assert.ok(
      conflicts[0].status === 400 || conflicts[0].status === 409,
      `Esperado status HTTP 400 ou 409 na concorrência de cotação, obtido HTTP ${conflicts[0].status}`,
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("6. usuário sem linha em subscriptions → concorrência cria assinatura corretamente via upsert atômico", async () => {
  const userId = await createTestUser("e206");
  const checkoutA = await createTestCheckout(userId, { validity_days: 30, months: 1 });
  const checkoutB = await createTestCheckout(userId, { validity_days: 60, months: 2, amount: 99.8 });
  const paymentA = `real-e2e-test6-A-${Date.now()}`;
  const paymentB = `real-e2e-test6-B-${Date.now()}`;
  try {
    // Garantia: nenhuma subscription prévia
    const subBefore = await getSubscription(userId);
    assert.equal(subBefore, null, "Usuário de fixture não deve ter assinatura prévia");

    // Dois pagamentos distintos concorrentes para usuário sem assinatura
    const [resA, resB] = await Promise.all([
      callRpc({ payment_id: paymentA, user_id: userId, validity_days: 30, checkout_id: checkoutA }),
      callRpc({ payment_id: paymentB, user_id: userId, validity_days: 60, months: 2, amount: 99.8, checkout_id: checkoutB }),
    ]);

    assert.ok(resA.ok, `RPC A falhou: HTTP ${resA.status} ${JSON.stringify(resA.data)}`);
    assert.ok(resB.ok, `RPC B falhou: HTTP ${resB.status} ${JSON.stringify(resB.data)}`);

    // Invariante: assinatura criada com upsert atômico — status = active
    const sub = await getSubscription(userId);
    assert.ok(sub, "Assinatura deve ter sido criada do zero");
    assert.equal(sub.status, "active");
    assert.ok(sub.current_period_end, "current_period_end deve estar definido");

    // Invariante: 2 linhas em subscription_payments
    const count = await countPayments(userId);
    assert.equal(count, 2, "Dois pagamentos distintos → 2 linhas em subscription_payments");

    // Invariante: vigência acumulada ~90 dias (30+60) para usuário novo
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(
      diffDays >= 88 && diffDays <= 92,
      `Esperado ~90 dias (30+60) para usuário novo, obtido ${diffDays}`,
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("7. user_id incompatível → payment_id de userA não estende assinatura de userB", async () => {
  const userA = await createTestUser("e207a");
  const userB = await createTestUser("e207b");
  const checkoutA = await createTestCheckout(userA, { validity_days: 30, months: 1 });
  const paymentId = `real-e2e-test7-${Date.now()}`;
  try {
    // Processa o pagamento corretamente para userA
    const resA = await callRpc({ payment_id: paymentId, user_id: userA, validity_days: 30, checkout_id: checkoutA });
    assert.ok(resA.ok, `RPC A falhou: HTTP ${resA.status} ${JSON.stringify(resA.data)}`);
    assert.equal(resA.data.already_processed, false);

    // Tenta reutilizar o MESMO payment_id para userB com a cotação checkoutA (pertence a userA)
    const resBWithA = await callRpc({ payment_id: paymentId, user_id: userB, validity_days: 30, checkout_id: checkoutA });
    assert.equal(
      resBWithA.ok,
      false,
      "Cotação de userA usada por userB deve ser rejeitada pela RPC",
    );
    const errCross = resBWithA.data ?? {};
    assert.ok(
      String(errCross.code ?? "").includes("22023") ||
      String(errCross.message ?? "").toLowerCase().includes("usuario") ||
      resBWithA.status === 400 || resBWithA.status === 422,
      `Esperado erro de ownership 22023, obtido HTTP ${resBWithA.status}: ${JSON.stringify(resBWithA.data)}`,
    );

    // Tenta reutilizar o MESMO payment_id para userB com uma cotação própria (checkoutB)
    const checkoutB = await createTestCheckout(userB, { validity_days: 30, months: 1 });
    const resBWithB = await callRpc({ payment_id: paymentId, user_id: userB, validity_days: 30, checkout_id: checkoutB });
    assert.equal(
      resBWithB.ok,
      false,
      "Reutilizar payment_id de userA com checkout de userB deve falhar por violação de ownership (22023)",
    );
    const errCrossDiv = resBWithB.data ?? {};
    assert.ok(
      String(errCrossDiv.code ?? "").includes("22023") ||
      String(errCrossDiv.message ?? "").toLowerCase().includes("usuario"),
      `Esperado erro de ownership (22023/usuario), obtido: ${JSON.stringify(resBWithB.data)}`,
    );
    assert.ok(
      resBWithB.status === 400 || resBWithB.status === 422 || resBWithB.status === 409,
      `Esperado status HTTP 400, 422 ou 409, obtido HTTP ${resBWithB.status}`,
    );

    // Invariante: userB NÃO tem assinatura criada
    const subB = await getSubscription(userB);
    assert.equal(
      subB,
      null,
      "userB não deve ter assinatura criada via payment_id de userA",
    );

    // Invariante: a linha em subscription_payments pertence a userA
    const row = await getPaymentRow(paymentId);
    assert.equal(row.user_id, userA, "A linha de payment pertence a userA");
    assert.notEqual(row.user_id, userB, "Não pertence a userB");

    // Invariante: UNIQUE — apenas 1 linha total para esse paymentId
    const total = await pgQuery(
      "SELECT count(*)::int AS n FROM public.subscription_payments WHERE mercadopago_payment_id = $1",
      [paymentId],
    );
    assert.equal(total[0].n, 1, "Deve existir apenas 1 linha para o payment_id");
  } finally {
    await cleanupUser(userA, userB);
  }
});

test("8. boundary estrito (validity_days, months, payment_id, cotacao obrigatoria) → RPC rejeita com 22023 e rollback total", async () => {
  const userId = await createTestUser("e208");
  const validCheckout = await createTestCheckout(userId, { validity_days: 30, months: 1 });
  try {
    // ── Sub-cenário 8a: validity_days = 0 ────────────────────────────────────
    const res0 = await callRpc({
      payment_id: `real-e2e-test8-vd0-${Date.now()}`,
      user_id: userId,
      validity_days: 0,
      months: 1,
      checkout_id: validCheckout,
    });
    assert.equal(res0.ok, false, "validity_days=0 deve ser rejeitado pela RPC");
    const err0 = res0.data ?? {};
    assert.ok(
      String(err0.code ?? "").includes("22023") ||
      String(err0.message ?? "").toLowerCase().includes("validity_days") ||
      String(err0.details ?? "").toLowerCase().includes("validity_days") ||
      res0.status === 400 ||
      res0.status === 422,
      `validity_days=0: esperado 22023/400/422, obtido HTTP ${res0.status} ${JSON.stringify(res0.data)}`,
    );

    // ── Sub-cenário 8b: validity_days = -30 ──────────────────────────────────
    const resNeg = await callRpc({
      payment_id: `real-e2e-test8-vdneg-${Date.now()}`,
      user_id: userId,
      validity_days: -30,
      months: 1,
      checkout_id: validCheckout,
    });
    assert.equal(resNeg.ok, false, "validity_days=-30 deve ser rejeitado pela RPC");
    const errNeg = resNeg.data ?? {};
    assert.ok(
      String(errNeg.code ?? "").includes("22023") ||
      String(errNeg.message ?? "").toLowerCase().includes("validity_days") ||
      String(errNeg.details ?? "").toLowerCase().includes("validity_days") ||
      resNeg.status === 400 ||
      resNeg.status === 422,
      `validity_days=-30: esperado 22023/400/422, obtido HTTP ${resNeg.status} ${JSON.stringify(resNeg.data)}`,
    );

    // ── Sub-cenário 8c: months = 0 ────────────────────────────────────────────
    const resM0 = await callRpc({
      payment_id: `real-e2e-test8-m0-${Date.now()}`,
      user_id: userId,
      validity_days: 30,
      months: 0,
      checkout_id: validCheckout,
    });
    assert.equal(resM0.ok, false, "months=0 deve ser rejeitado pela RPC");
    const errM0 = resM0.data ?? {};
    assert.ok(
      String(errM0.code ?? "").includes("22023") ||
      String(errM0.message ?? "").toLowerCase().includes("months") ||
      String(errM0.details ?? "").toLowerCase().includes("months") ||
      resM0.status === 400 ||
      resM0.status === 422,
      `months=0: esperado 22023/400/422, obtido HTTP ${resM0.status} ${JSON.stringify(resM0.data)}`,
    );

    // ── Sub-cenário 8d: months = -1 ───────────────────────────────────────────
    const resMneg = await callRpc({
      payment_id: `real-e2e-test8-mneg-${Date.now()}`,
      user_id: userId,
      validity_days: 30,
      months: -1,
      checkout_id: validCheckout,
    });
    assert.equal(resMneg.ok, false, "months=-1 deve ser rejeitado pela RPC");
    const errMneg = resMneg.data ?? {};
    assert.ok(
      String(errMneg.code ?? "").includes("22023") ||
      String(errMneg.message ?? "").toLowerCase().includes("months") ||
      String(errMneg.details ?? "").toLowerCase().includes("months") ||
      resMneg.status === 400 ||
      resMneg.status === 422,
      `months=-1: esperado 22023/400/422, obtido HTTP ${resMneg.status} ${JSON.stringify(resMneg.data)}`,
    );

    // ── Sub-cenário 8e: payment_id vazio → rejeição (guard: trim = '') ────────
    const resEmpty = await callRpc({
      payment_id: "",
      user_id: userId,
      validity_days: 30,
      months: 1,
      checkout_id: validCheckout,
    });
    assert.equal(resEmpty.ok, false, "payment_id vazio deve ser rejeitado");
    const errEmpty = resEmpty.data ?? {};
    assert.ok(
      String(errEmpty.code ?? "").includes("22023") ||
      String(errEmpty.message ?? "").toLowerCase().includes("ausente") ||
      resEmpty.status === 400 ||
      resEmpty.status === 422,
      `payment_id vazio: esperado 22023/400/422, obtido HTTP ${resEmpty.status} ${JSON.stringify(resEmpty.data)}`,
    );

    // ── Sub-cenário 8f: chamada sem checkout (omitido) → rejeição ─────────────
    const resNoCheckout = await callRpc({
      payment_id: `real-e2e-test8-nochk-${Date.now()}`,
      user_id: userId,
      validity_days: 30,
      months: 1,
    });
    assert.equal(resNoCheckout.ok, false, "Chamada sem checkout deve ser rejeitada");

    // ── Sub-cenário 8g: chamada com checkout nulo explícito → 22023 ───────────
    const resNullCheckout = await callRpc({
      payment_id: `real-e2e-test8-nullchk-${Date.now()}`,
      user_id: userId,
      validity_days: 30,
      months: 1,
      checkout_id: null,
    });
    assert.equal(resNullCheckout.ok, false, "checkout_id nulo deve ser rejeitado com 22023");
    const errNullChk = resNullCheckout.data ?? {};
    assert.ok(
      String(errNullChk.code ?? "").includes("22023") ||
      String(errNullChk.message ?? "").toLowerCase().includes("cotacao") ||
      resNullCheckout.status === 400 ||
      resNullCheckout.status === 422,
      `checkout nulo: esperado 22023, obtido HTTP ${resNullCheckout.status}: ${JSON.stringify(resNullCheckout.data)}`,
    );

    // ── Sub-cenário 8h: checkout inexistente → rejeição 22023 ─────────────────
    const nonexistentCheckout = randomUUID();
    const resNonexistent = await callRpc({
      payment_id: `real-e2e-test8-nonexist-${Date.now()}`,
      user_id: userId,
      validity_days: 30,
      months: 1,
      checkout_id: nonexistentCheckout,
    });
    assert.equal(resNonexistent.ok, false, "checkout inexistente deve ser rejeitado");
    const errNonexist = resNonexistent.data ?? {};
    assert.ok(
      String(errNonexist.code ?? "").includes("22023") ||
      String(errNonexist.message ?? "").toLowerCase().includes("inexistente") ||
      resNonexistent.status === 400 ||
      resNonexistent.status === 422,
      `checkout inexistente: esperado 22023, obtido HTTP ${resNonexistent.status}: ${JSON.stringify(resNonexistent.data)}`,
    );

    // ── Sub-cenário 8i: checkout expirado → rejeição 22023 ────────────────────
    const expiredCheckout = await createTestCheckout(userId, { validity_days: 30, months: 1, expired: true });
    const resExpired = await callRpc({
      payment_id: `real-e2e-test8-expired-${Date.now()}`,
      user_id: userId,
      validity_days: 30,
      months: 1,
      checkout_id: expiredCheckout,
    });
    assert.equal(resExpired.ok, false, "checkout expirado deve ser rejeitado");
    const errExpired = resExpired.data ?? {};
    assert.ok(
      String(errExpired.code ?? "").includes("22023") ||
      String(errExpired.message ?? "").toLowerCase().includes("expirada") ||
      resExpired.status === 400 ||
      resExpired.status === 422,
      `checkout expirado: esperado 22023, obtido HTTP ${resExpired.status}: ${JSON.stringify(resExpired.data)}`,
    );

    // ── Sub-cenário 8j: user_id nulo → rejeição via pg driver direto ──────────
    const client = await pgConnect();
    try {
      await assert.rejects(
        () => client.query(
          "SELECT public.process_mercadopago_subscription_payment($1, $2, $3, $4, $5, $6, $7)",
          ["valid-payment-nulluser-e208", null, 1, 30, 49.9, "approved", validCheckout],
        ),
        (err) => {
          return (
            err.code === "22023" ||
            String(err.message ?? "").toLowerCase().includes("usuario") ||
            String(err.message ?? "").toLowerCase().includes("ausente")
          );
        },
        "user_id nulo deve ser rejeitado com código 22023",
      );
    } finally {
      await client.end();
    }

    // Invariante final: após todos os sub-cenários inválidos, zero registros persistidos
    const totalCount = await countPayments(userId);
    assert.equal(totalCount, 0, "Invariante final: zero linhas em subscription_payments após todos os sub-cenários inválidos");
    const finalSub = await getSubscription(userId);
    assert.equal(finalSub, null, "Invariante final: nenhuma assinatura criada após todos os sub-cenários inválidos");
  } finally {
    await cleanupUser(userId);
  }
});

test("9. valor e metadata registrados conforme contrato → amount, months, status, processed_at corretos", async () => {
  const userId = await createTestUser("e209");
  const paymentId = `real-e2e-test9-${Date.now()}`;
  const expectedAmount = 149.9;
  const expectedMonths = 3;
  const expectedDays = 90;
  const expectedStatus = "approved";
  const checkoutId = await createTestCheckout(userId, {
    validity_days: expectedDays,
    months: expectedMonths,
    amount: expectedAmount,
  });
  try {
    const before = new Date();
    const res = await callRpc({
      payment_id: paymentId,
      user_id: userId,
      months: expectedMonths,
      validity_days: expectedDays,
      amount: expectedAmount,
      status: expectedStatus,
      checkout_id: checkoutId,
    });
    const after = new Date();

    assert.ok(res.ok, `RPC falhou: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
    assert.equal(res.data.already_processed, false);

    // Verificação dos campos armazenados no PostgreSQL
    const row = await getPaymentRow(paymentId);
    assert.ok(row, "Linha deve existir em subscription_payments");

    // checkout_id vinculado
    assert.equal(row.checkout_id, checkoutId);

    // amount deve ser salvo com precisão decimal
    assert.equal(
      parseFloat(row.amount),
      expectedAmount,
      `amount esperado ${expectedAmount}, obtido ${row.amount}`,
    );

    // months armazenado
    assert.equal(
      Number(row.months),
      expectedMonths,
      `months esperado ${expectedMonths}, obtido ${row.months}`,
    );

    // validity_days armazenado
    assert.equal(
      Number(row.validity_days),
      expectedDays,
      `validity_days esperado ${expectedDays}, obtido ${row.validity_days}`,
    );

    // status armazenado
    assert.equal(
      row.status,
      expectedStatus,
      `status esperado "${expectedStatus}", obtido "${row.status}"`,
    );

    // mercadopago_payment_id salvo sem espaços extras (trim aplicado pela RPC)
    assert.equal(row.mercadopago_payment_id, paymentId);

    // user_id correto
    assert.equal(row.user_id, userId);

    // processed_at dentro da janela temporal do teste
    const processedAt = new Date(row.processed_at);
    assert.ok(
      processedAt >= before && processedAt <= after,
      `processed_at deve estar dentro da janela do teste ` +
      `(${before.toISOString()} – ${after.toISOString()}), ` +
      `obtido ${processedAt.toISOString()}`,
    );

    // current_period_end retornado pela RPC deve coincidir com o banco
    const sub = await getSubscription(userId);
    assert.ok(sub, "Assinatura deve existir");
    assert.equal(
      new Date(sub.current_period_end).toISOString(),
      new Date(res.data.current_period_end).toISOString(),
      "current_period_end da RPC deve coincidir com o valor no banco",
    );

    // Vigência ~90 dias
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(diffDays >= 89 && diffDays <= 91, `Esperado ~90 dias, obtido ${diffDays}`);
  } finally {
    await cleanupUser(userId);
  }
});
