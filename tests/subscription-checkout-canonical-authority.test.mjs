import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20260930100000_subscription_checkout_canonical_authority.sql";

function readMigration() {
  return fs.readFileSync(path.join(ROOT, "supabase", "migrations", MIGRATION), "utf-8");
}

// MAI-152: opcao A — mesma assinatura, autoridade canonica da cotacao.
// A RPC nunca confia em months/validity_days/amount do caller.

test("MAI-152: migration mantem mesma assinatura de 7 args sem DEFAULT (opcao A, sem quebrar prod)", () => {
  const sql = readMigration();
  assert.match(
    sql,
    /create or replace function public\.process_mercadopago_subscription_payment\(\s*p_payment_id text,\s*p_user_id uuid,\s*p_months integer,\s*p_validity_days integer,\s*p_amount numeric,\s*p_status text,\s*p_checkout_id uuid\s*\)/i,
    "assinatura deve permanecer 7 args (text, uuid, integer, integer, numeric, text, uuid)",
  );
  assert.ok(
    !/p_checkout_id uuid default/i.test(sql),
    "p_checkout_id deve seguir obrigatorio, sem DEFAULT",
  );
  assert.ok(
    !/drop function if exists public\.process_mercadopago_subscription_payment/i.test(sql),
    "opcao A nao faz DROP (sem janela de overload entre migration e deploy)",
  );
  assert.match(
    sql,
    /revoke execute on function public\.process_mercadopago_subscription_payment\(text, uuid, integer, integer, numeric, text, uuid\)/i,
    "grants preservados na mesma assinatura",
  );
  assert.match(
    sql,
    /grant execute on function public\.process_mercadopago_subscription_payment\(text, uuid, integer, integer, numeric, text, uuid\) to service_role/i,
    "somente service_role pode executar",
  );
});

test("MAI-152: cotacao e bloqueada atomicamente e valida single consumption", () => {
  const sql = readMigration();
  assert.match(
    sql,
    /from public\.subscription_checkouts\s+where id = p_checkout_id for update/i,
    "cotacao deve ser lida com FOR UPDATE (lock atomico)",
  );
  assert.match(sql, /pg_advisory_xact_lock/i, "concorrencia deve seguir serializada por advisory lock");
  assert.match(sql, /Cotacao ja consumida por outro pagamento/i, "single consumption preservado (23505)");
  assert.match(sql, /on conflict \(mercadopago_payment_id\) do nothing/i, "payment_id segue globalmente idempotente");
  assert.match(sql, /Cotacao divergente para pagamento ja processado/i, "consistencia 1:1 pagamento<->cotacao preservada");
});

test("MAI-152: months/validity_days/amount divergentes sao rejeitados (22023) e ledger deriva da cotacao", () => {
  const sql = readMigration();
  assert.match(sql, /Divergencia de months em relacao a cotacao/i, "months divergente deve ser rejeitado");
  assert.match(sql, /Divergencia de validity_days em relacao a cotacao/i, "validity_days divergente deve ser rejeitado");
  assert.match(sql, /Divergencia de amount em relacao a cotacao/i, "amount divergente deve ser rejeitado");
  // Autoridade exclusiva apos as rejeicoes.
  assert.match(sql, /v_months := v_c_months/i, "months do ledger/vigencia deriva da cotacao");
  assert.match(sql, /v_validity_days := v_c_validity/i, "validity_days da vigencia deriva da cotacao");
  assert.match(
    sql,
    /v_c_amount\s*:=\s*v_checkout\.amount/i,
    "amount canonico deriva de subscription_checkouts",
  );
});

test("MAI-152: plan_id, currency, amount_cents e catalog_version vem do registro canonico", () => {
  const sql = readMigration();
  assert.match(sql, /v_c_plan_id\s*:=\s*v_checkout\.plan_id/i, "plan_id deriva da cotacao");
  assert.match(sql, /v_c_currency\s*:=\s*v_checkout\.currency/i, "currency deriva da cotacao");
  assert.match(sql, /v_c_amount_cents\s*:=\s*v_checkout\.amount_cents/i, "amount_cents deriva da cotacao");
  assert.match(sql, /v_c_catalog\s*:=\s*v_checkout\.catalog_version/i, "catalog_version deriva da cotacao");
  assert.match(sql, /Cotacao com moeda nao suportada/i, "moeda da cotacao validada fail-closed (BRL)");
  assert.match(sql, /Cotacao sem plan_id canonico/i, "plan_id canonico exigido");
  // Ledger persiste os canonicos.
  assert.match(sql, /plan_id,\s*currency,\s*amount_cents,\s*catalog_version/si, "INSERT do ledger inclui colunas canonicas");
  assert.match(sql, /v_c_plan_id/i, "INSERT usa plan_id canonico");
  assert.match(sql, /v_c_currency/i, "INSERT usa currency canonica");
});

test("MAI-152: nao volta a confiar em metadata do MP nem remove checkout", () => {
  const sql = readMigration();
  assert.ok(!/metadata\s*->/i.test(sql), "RPC nao deve ler metadata do provedor como fonte canonica");
  assert.ok(!/current_setting\(/i.test(sql), "RPC nao deve ler configuracao de request como fonte financeira");
  assert.ok(
    !/delete\s+from\s+public\.subscription_checkouts/i.test(sql),
    "checkout persistido nunca e removido",
  );
  assert.ok(
    !/grant execute on function public\.process_mercadopago_subscription_payment.*to\s+(public|anon|authenticated)/i.test(sql),
    "grants nao enfraquecidos (sem concessao a public/anon/authenticated)",
  );
});

test("MAI-152: checkout mensal nunca produz vigencia anual por parametro divergente", () => {
  const sql = readMigration();
  // A rejeicao ocorre ANTES de qualquer INSERT em subscription_payments/subscriptions
  // ou UPDATE de checkout como completed: ordem fail-closed.
  const divergencePos = sql.search(/Divergencia de validity_days em relacao a cotacao/i);
  const ledgerInsertPos = sql.search(/insert into public\.subscription_payments \(/i);
  const grantVigenciaPos = sql.search(/insert into public\.subscriptions \(/i);
  assert.ok(divergencePos !== -1 && ledgerInsertPos !== -1, "ambos os blocos devem existir");
  assert.ok(divergencePos < ledgerInsertPos, "divergencia deve ser rejeitada antes do ledger");
  assert.ok(divergencePos < grantVigenciaPos, "divergencia deve ser rejeitada antes de conceder vigencia");
});
