import assert from "node:assert/strict";
import { test } from "node:test";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_USER_A_EMAIL", "E2E_USER_A_PASSWORD", "E2E_USER_B_EMAIL", "E2E_USER_B_PASSWORD"];

async function auth(email, password) {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await r.json();
  assert.equal(r.ok, true, `login falhou: HTTP ${r.status}`);
  return body.access_token;
}

async function request(token, path, init = {}) {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await r.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { r, body };
}
const ok = async (result, label) => { assert.equal(result.r.ok, true, `${label}: HTTP ${result.r.status} ${JSON.stringify(result.body)}`); return result.body; };

test("Supabase real: RLS e invariantes financeiras", async (t) => {
  if (process.env.RUN_REAL_E2E !== "1") { t.skip("bloqueado; use RUN_REAL_E2E=1 e ambiente Supabase de teste"); return; }
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`E2E real sem configuração: ${missing.join(", ")}`);
  const [a, b] = await Promise.all([auth(process.env.E2E_USER_A_EMAIL, process.env.E2E_USER_A_PASSWORD), auth(process.env.E2E_USER_B_EMAIL, process.env.E2E_USER_B_PASSWORD)]);
  const date = new Date().toISOString().slice(0, 10);
  const place = await ok(await request(a, "places", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ nome: `E2E-${Date.now()}` }) }), "local");
  const placeId = place[0].id;
  const shifts = await ok(await request(a, "shifts", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ place_id: placeId, data: "2020-01-01", hora_inicio: "08:00", hora_fim: "09:00", valor_previsto: 100, status: "agendado" }) }), "plantão");
  const shiftId = shifts[0].id;
  await ok(await request(a, `shifts?id=eq.${shiftId}`, { method: "PATCH", body: JSON.stringify({ status: "realizado" }) }), "realização");
  const obligations = await ok(await request(a, `obligations?shift_id=eq.${shiftId}&select=id,valor_devido`), "obrigação");
  assert.equal(obligations.length, 1); assert.equal(Number(obligations[0].valor_devido), 100);
  assert.deepEqual(await ok(await request(b, `shifts?id=eq.${shiftId}&select=id`), "RLS cruzada"), []);
  const pay = (token, value) => request(token, "rpc/register_payment", { method: "POST", body: JSON.stringify({ p_obligation_id: obligations[0].id, p_valor: value, p_data_pagamento: date }) });
  await ok(await pay(a, 40), "pagamento parcial");
  assert.equal((await pay(a, 61)).r.ok, false, "overpayment aceito");
  assert.equal((await pay(b, 1)).r.ok, false, "acesso cruzado aceito");
  await ok(await pay(a, 60), "pagamento total");
  let balance = await ok(await request(a, `obligations_with_balance?id=eq.${obligations[0].id}&select=saldo,atrasada`), "saldo");
  assert.equal(Number(balance[0].saldo), 0); assert.equal(balance[0].atrasada, false);
  const payment = await ok(await request(a, `payments?obligation_id=eq.${obligations[0].id}&status=eq.registrado&select=id`), "pagamento registrado");
  await ok(await request(a, `payments?id=eq.${payment[0].id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelado" }) }), "cancelamento lógico");
  balance = await ok(await request(a, `obligations_with_balance?id=eq.${obligations[0].id}&select=saldo,atrasada`), "atraso");
  assert.equal(Number(balance[0].saldo), 100); assert.equal(balance[0].atrasada, true);
});
