import assert from "node:assert/strict";
import { test } from "node:test";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_USER_A_EMAIL", "E2E_USER_A_PASSWORD", "E2E_USER_B_EMAIL", "E2E_USER_B_PASSWORD"];
const endpoint = (path) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/${path}`;

async function auth(email, password) {
  const r = await fetch(endpoint("auth/v1/token?grant_type=password"), { method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await r.json(); assert.equal(r.ok, true, `login falhou: HTTP ${r.status}`); return body.access_token;
}
async function request(token, path, init = {}) {
  const r = await fetch(endpoint(`rest/v1/${path}`), { ...init, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await r.text(); let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; } return { r, body };
}
const ok = async (result, label) => { assert.equal(result.r.ok, true, `${label}: HTTP ${result.r.status} ${JSON.stringify(result.body)}`); return result.body; };

test("Supabase real: RLS e invariantes financeiras", async () => {
  if (process.env.RUN_REAL_E2E !== "1") throw new Error("E2E real bloqueado: defina RUN_REAL_E2E=1 e use um Supabase de teste");
  const missing = required.filter((name) => !process.env[name]); if (missing.length) throw new Error(`E2E real sem configuração: ${missing.join(", ")}`);
  const [a, b] = await Promise.all([auth(process.env.E2E_USER_A_EMAIL, process.env.E2E_USER_A_PASSWORD), auth(process.env.E2E_USER_B_EMAIL, process.env.E2E_USER_B_PASSWORD)]);
  const date = new Date().toISOString().slice(0, 10);
  const place = await ok(await request(a, "places", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ nome: `E2E-${Date.now()}` }) }), "local A"); const placeId = place[0].id;
  const shifts = await ok(await request(a, "shifts", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ place_id: placeId, data: "2020-01-01", hora_inicio: "08:00", hora_fim: "09:00", valor_previsto: 100, status: "agendado" }) }), "plantão A"); const shiftId = shifts[0].id;
  await ok(await request(a, `shifts?id=eq.${shiftId}`, { method: "PATCH", body: JSON.stringify({ status: "realizado" }) }), "realizar plantão");
  const obligations = await ok(await request(a, `obligations?shift_id=eq.${shiftId}&select=id,valor_devido`), "obrigação A"); assert.equal(obligations.length, 1); assert.equal(Number(obligations[0].valor_devido), 100); const obligationId = obligations[0].id;
  assert.deepEqual(await ok(await request(b, `places?id=eq.${placeId}&select=id`), "B não lê place A"), []); assert.deepEqual(await ok(await request(b, `shifts?id=eq.${shiftId}&select=id`), "B não lê shift A"), []); assert.deepEqual(await ok(await request(b, `obligations?id=eq.${obligationId}&select=id`), "B não lê obligation A"), []); assert.deepEqual(await ok(await request(b, `payments?obligation_id=eq.${obligationId}&select=id`), "B não lê payments A"), []);
  const edit = await request(b, `shifts?id=eq.${shiftId}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ valor_previsto: 999 }) }); assert.equal(edit.r.ok, true); assert.deepEqual(edit.body, [], "B não edita shift A");
  const foreignShift = await request(b, "shifts", { method: "POST", body: JSON.stringify({ place_id: placeId, data: date, hora_inicio: "10:00", hora_fim: "11:00", valor_previsto: 1 }) }); assert.equal(foreignShift.r.ok, false, "B criou shift usando place A");
  const pay = (token, value) => request(token, "rpc/register_payment", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ p_obligation_id: obligationId, p_valor: value, p_data_pagamento: date }) });
  const payment40 = await ok(await pay(a, 40), "pagamento 40"); const payment60 = await ok(await pay(a, 60), "pagamento 60"); const payment40Id = payment40.id; const payment60Id = payment60.id;
  let balance = await ok(await request(a, `obligations_with_balance?id=eq.${obligationId}&select=saldo,atrasada`), "saldo total"); assert.equal(Number(balance[0].saldo), 0); assert.equal((await pay(a, 1)).r.ok, false, "overpayment aceito"); assert.equal((await pay(b, 1)).r.ok, false, "RPC cruzada aceita");
  await ok(await request(a, `payments?id=eq.${payment40Id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelado" }) }), "cancelar 40"); let history = await ok(await request(a, `payments?obligation_id=eq.${obligationId}&select=id,valor,status&order=valor`), "histórico após cancelar 40"); assert.deepEqual(history.map(({ valor, status }) => [Number(valor), status]), [[40, "cancelado"], [60, "registrado"]]); balance = await ok(await request(a, `obligations_with_balance?id=eq.${obligationId}&select=saldo,atrasada`), "saldo após cancelar 40"); assert.equal(Number(balance[0].saldo), 40); assert.equal(balance[0].atrasada, true);
  await ok(await request(a, `payments?id=eq.${payment60Id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelado" }) }), "cancelar 60"); history = await ok(await request(a, `payments?obligation_id=eq.${obligationId}&select=id,valor,status&order=valor`), "histórico final"); assert.deepEqual(history.map(({ valor, status }) => [Number(valor), status]), [[40, "cancelado"], [60, "cancelado"]]); balance = await ok(await request(a, `obligations_with_balance?id=eq.${obligationId}&select=saldo,atrasada`), "saldo final"); assert.equal(Number(balance[0].saldo), 100); assert.equal(balance[0].atrasada, true);
});
