/**
 * MeuPlantao — Subscription Reversal Real PostgreSQL E2E (MAI-136)
 *
 * Valida a reconciliacao reconcile_mercadopago_reversal no PostgreSQL real:
 * aprovado → reembolsado/chargeback, duplicacao, fora de ordem e dois
 * pagamentos com um estornado. Ledger e entitlement convergem sem dupla
 * contagem e sem apagar pagamentos.
 *
 * Variaveis obrigatorias:
 *   RUN_REAL_E2E=1, DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso:
 *   RUN_REAL_E2E=1 DATABASE_URL=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node --experimental-strip-types --test tests/subscription-reversal-real-e2e.real.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

if (process.env.RUN_REAL_E2E !== "1") {
  throw new Error(
    "Suite real bloqueada: defina RUN_REAL_E2E=1 e aponte para um Supabase de teste. Nunca execute contra producao.",
  );
}

const REQUIRED_VARS = ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const MISSING_VARS = REQUIRED_VARS.filter((v) => !process.env[v]);
if (MISSING_VARS.length > 0) {
  throw new Error(`E2E real sem configuracao: ${MISSING_VARS.join(", ")}`);
}

const { default: pg } = await import("pg");
const { Client: PgClient } = pg;

const DB_URL = process.env.DATABASE_URL;
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function pgConnect() {
  const client = new PgClient({ connectionString: DB_URL });
  await client.connect();
  return client;
}

async function pgQuery(sql, params = []) {
  const client = await pgConnect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function callRpc(fn, body) {
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
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

async function callProcess(params) {
  return callRpc("process_mercadopago_subscription_payment", {
    p_payment_id: params.payment_id,
    p_user_id: params.user_id,
    p_months: params.months ?? 1,
    p_validity_days: params.validity_days ?? 30,
    p_amount: params.amount ?? 12.9,
    p_status: params.status ?? "approved",
    // MAI-147 fail-closed (migration 29400000): cotacao obrigatoria.
    ...(params.checkout_id ? { p_checkout_id: params.checkout_id } : {}),
  });
}

async function callReversal(params) {
  return callRpc("reconcile_mercadopago_reversal", {
    p_payment_id: params.payment_id,
    p_user_id: params.user_id,
    p_reversal_status: params.reversal_status,
    p_months: params.months ?? 1,
    p_validity_days: params.validity_days ?? 30,
    p_amount: params.amount ?? 12.9,
  });
}

function fixtureUUID(suffix) {
  const suffixMap = {
    "r101": "000000000101",
    "r102": "000000000102",
    "r103": "000000000103",
    "r104": "000000000104",
    "r105": "000000000105",
    "r106": "000000000106",
  };
  const hex = suffixMap[suffix] ?? suffix.padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${hex}`;
}

async function createTestUser(suffix) {
  const userId = fixtureUUID(suffix);
  const email = `sub-rev-e2e-${suffix}@test.local`;
  await pgQuery(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'fixture-hash', now(), now() - interval '20 days', now())
     ON CONFLICT (id) DO NOTHING`,
    [userId, email],
  );
  return userId;
}

async function getSubscription(userId) {
  const rows = await pgQuery("SELECT * FROM public.subscriptions WHERE user_id = $1", [userId]);
  return rows[0] ?? null;
}

async function getPaymentRow(paymentId) {
  const rows = await pgQuery(
    "SELECT * FROM public.subscription_payments WHERE mercadopago_payment_id = $1",
    [paymentId],
  );
  return rows[0] ?? null;
}

async function countEvents(paymentId) {
  const rows = await pgQuery(
    "SELECT count(*)::int AS n FROM public.subscription_payment_events WHERE mercadopago_payment_id = $1",
    [paymentId],
  );
  return rows[0].n;
}

async function cleanupUser(...userIds) {
  for (const userId of userIds) {
    try {
      await pgQuery("DELETE FROM auth.users WHERE id = $1", [userId]);
    } catch {
      // Silencia erros de cleanup
    }
  }
}

test("1. aprovado → reembolsado: vigencia revogada, ledger preservado com historico", async () => {
  const userId = await createTestUser("r101");
  const paymentId = `real-rev-test1-${Date.now()}`;
  try {
    const approved = await callProcess({ payment_id: paymentId, user_id: userId, validity_days: 30 });
    assert.ok(approved.ok, `aprovado falhou: HTTP ${approved.status} ${JSON.stringify(approved.data)}`);
    assert.equal(approved.data.already_processed, false);

    const subBefore = await getSubscription(userId);
    assert.ok(subBefore, "assinatura deve existir apos aprovado");
    assert.ok(new Date(subBefore.current_period_end).getTime() > Date.now());

    const rev = await callReversal({ payment_id: paymentId, user_id: userId, reversal_status: "refunded" });
    assert.ok(rev.ok, `reversao falhou: HTTP ${rev.status} ${JSON.stringify(rev.data)}`);
    assert.equal(rev.data.reversed, true);
    assert.equal(rev.data.contributed, true);
    assert.equal(rev.data.validity_days_removed, 30);

    // Ledger preservado: linha continua existindo com status refunded (sem delete fisico)
    const row = await getPaymentRow(paymentId);
    assert.ok(row, "linha do ledger deve ser preservada");
    assert.equal(row.status, "refunded");
    assert.ok(row.reversed_at, "reversed_at deve estar preenchido");

    // Historico auditavel
    assert.equal(await countEvents(paymentId), 1);

    // Entitlement revogado: fim <= now. O banco grava 'canceled' (único estado
    // aceito pelo CHECK subscriptions_status_check); 'expired' é apenas rótulo
    // derivado na resposta da RPC, nunca persistido (MAI-147).
    const sub = await getSubscription(userId);
    assert.ok(sub, "assinatura deve continuar existindo");
    assert.equal(sub.status, "canceled");
    assert.equal(rev.data.status, "expired");
    assert.ok(
      new Date(sub.current_period_end).getTime() <= Date.now() + 60_000,
      `current_period_end deve estar revogado, obtido ${sub.current_period_end}`,
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("2. evento de estorno duplicado e idempotente (sem dupla subtracao)", async () => {
  const userId = await createTestUser("r102");
  const paymentId = `real-rev-test2-${Date.now()}`;
  try {
    const approved = await callProcess({ payment_id: paymentId, user_id: userId, validity_days: 30 });
    assert.ok(approved.ok);

    const rev1 = await callReversal({ payment_id: paymentId, user_id: userId, reversal_status: "charged_back" });
    assert.ok(rev1.ok);
    assert.equal(rev1.data.reversed, true);
    const endAfterFirst = rev1.data.current_period_end;

    const rev2 = await callReversal({ payment_id: paymentId, user_id: userId, reversal_status: "charged_back" });
    assert.ok(rev2.ok, `2a reversao falhou: HTTP ${rev2.status}`);
    assert.equal(rev2.data.already_reversed, true);
    assert.equal(rev2.data.reversed, false);

    const row = await getPaymentRow(paymentId);
    assert.equal(row.status, "charged_back");

    const sub = await getSubscription(userId);
    assert.equal(
      sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
      endAfterFirst ? new Date(endAfterFirst).toISOString() : null,
      "current_period_end nao pode mudar no reprocessamento do estorno",
    );
  } finally {
    await cleanupUser(userId);
  }
});

test("3. fora de ordem: estorno antes do aprovado nao concede vigencia posterior", async () => {
  const userId = await createTestUser("r103");
  const paymentId = `real-rev-test3-${Date.now()}`;
  try {
    // Estorno chega primeiro (pagamento desconhecido): cria stub revertido.
    const revFirst = await callReversal({ payment_id: paymentId, user_id: userId, reversal_status: "refunded" });
    assert.ok(revFirst.ok, `estorno fora de ordem falhou: HTTP ${revFirst.status}`);
    assert.equal(revFirst.data.not_found, true);

    // Evento approved antigo chega depois: nao pode conceder vigencia.
    const lateApproved = await callProcess({ payment_id: paymentId, user_id: userId, validity_days: 30 });
    assert.ok(lateApproved.ok);
    assert.equal(lateApproved.data.already_processed, true, "approved tardio nao deve processar novamente");
    assert.equal(lateApproved.data.validity_days_added, 0);

    const row = await getPaymentRow(paymentId);
    assert.equal(row.status, "refunded", "status revertido deve prevalecer sobre evento antigo");

    const sub = await getSubscription(userId);
    assert.equal(sub, null, "nenhuma vigencia deve ser concedida fora de ordem");
  } finally {
    await cleanupUser(userId);
  }
});

test("4. dois pagamentos com um estornado: preserva o periodo do pagamento saudavel", async () => {
  const userId = await createTestUser("r104");
  const paymentA = `real-rev-test4-A-${Date.now()}`;
  const paymentB = `real-rev-test4-B-${Date.now()}`;
  try {
    const resA = await callProcess({ payment_id: paymentA, user_id: userId, validity_days: 30 });
    assert.ok(resA.ok);
    const resB = await callProcess({ payment_id: paymentB, user_id: userId, validity_days: 90 });
    assert.ok(resB.ok);

    const revA = await callReversal({ payment_id: paymentA, user_id: userId, reversal_status: "refunded" });
    assert.ok(revA.ok, `reversao A falhou: HTTP ${revA.status}`);
    assert.equal(revA.data.reversed, true);
    assert.equal(revA.data.active_payments, 1, "deve restar 1 pagamento ativo");

    // Ledger: ambas as linhas preservadas, apenas A revertida
    const rowA = await getPaymentRow(paymentA);
    const rowB = await getPaymentRow(paymentB);
    assert.equal(rowA.status, "refunded");
    assert.equal(rowB.status, "approved");

    // Entitlement: ~90 dias do pagamento B remanescente (replay pela ancora original)
    const sub = await getSubscription(userId);
    assert.ok(sub, "assinatura deve existir");
    assert.equal(sub.status, "active");
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(diffDays >= 88 && diffDays <= 92, `Esperado ~90 dias de B, obtido ${diffDays}`);
  } finally {
    await cleanupUser(userId);
  }
});

test("5. chargeback de usuario distinto nao altera entitlement (ownership)", async () => {
  const userA = await createTestUser("r105");
  // Reusa o namespace r105 com sufixo distinto via segundo UUID derivado manualmente
  const userB = fixtureUUID("r105");
  const userBAlt = "00000000-0000-4000-8000-000000000115";
  await pgQuery(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'fixture-hash', now(), now() - interval '20 days', now())
     ON CONFLICT (id) DO NOTHING`,
    [userBAlt, "sub-rev-e2e-r105b@test.local"],
  );
  const paymentId = `real-rev-test5-${Date.now()}`;
  try {
    const approved = await callProcess({ payment_id: paymentId, user_id: userA, validity_days: 30 });
    assert.ok(approved.ok);

    const cross = await callReversal({ payment_id: paymentId, user_id: userBAlt, reversal_status: "refunded" });
    assert.ok(cross.ok);
    assert.equal(cross.data.ownership_mismatch, true);
    assert.equal(cross.data.reversed, false);

    const row = await getPaymentRow(paymentId);
    assert.equal(row.user_id, userA);
    assert.equal(row.status, "approved", "status nao deve mudar em tentativa cross-user");

    const subA = await getSubscription(userA);
    assert.equal(subA.status, "active");
    void userB;
  } finally {
    await cleanupUser(userA, userBAlt);
  }
});

test("6. MAI-147: estorno preserva lastro legitimo anterior sem modelo no ledger (piso decremental)", async () => {
  const userId = await createTestUser("r106");
  const paymentId = `real-rev-test6-${Date.now()}`;
  try {
    // Lastro legítimo anterior (trial convertido/legado): vigência futura sem linha no ledger.
    const legacyEnd = new Date(Date.now() + 60 * MS_PER_DAY).toISOString();
    await pgQuery(
      `INSERT INTO public.subscriptions (user_id, status, current_period_end, updated_at)
       VALUES ($1, 'active', $2, now())
       ON CONFLICT (user_id) DO UPDATE SET status = 'active', current_period_end = EXCLUDED.current_period_end`,
      [userId, legacyEnd],
    );

    const approved = await callProcess({ payment_id: paymentId, user_id: userId, validity_days: 30 });
    assert.ok(approved.ok);

    const rev = await callReversal({ payment_id: paymentId, user_id: userId, reversal_status: "refunded" });
    assert.ok(rev.ok, `reversao com lastro falhou: HTTP ${rev.status}`);
    assert.equal(rev.data.reversed, true);
    assert.equal(rev.data.contributed, true);

    // Recomposta = max(replay vazio, piso decremental): remove apenas a contribuição
    // do pagamento revertido (+30d), preservando o lastro legítimo anterior (~60 dias).
    const sub = await getSubscription(userId);
    assert.equal(sub.status, "active");
    const diffDays = Math.round((new Date(sub.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(diffDays >= 58 && diffDays <= 62, `Esperado ~60 dias de lastro preservado, obtido ${diffDays}`);
  } finally {
    await cleanupUser(userId);
  }
});
