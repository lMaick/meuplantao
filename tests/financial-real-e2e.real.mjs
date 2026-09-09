import assert from "node:assert/strict";
import { test } from "node:test";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_USER_A_EMAIL", "E2E_USER_A_PASSWORD", "E2E_USER_B_EMAIL", "E2E_USER_B_PASSWORD"];
const endpoint = (path) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/${path}`;
async function auth(email, password) { const r = await fetch(endpoint("auth/v1/token?grant_type=password"), { method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); const body = await r.json(); assert.equal(r.ok, true, `login falhou: HTTP ${r.status}`); return body.access_token; }
const userId = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;
async function request(token, path, init = {}) { const r = await fetch(endpoint(`rest/v1/${path}`), { ...init, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } }); const text = await r.text(); let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; } return { r, body }; }
const ok = async (result, label) => { assert.equal(result.r.ok, true, `${label}: HTTP ${result.r.status} ${JSON.stringify(result.body)}`); return result.body; };
const rejected = async (result, label) => { const resolved = await result; assert.equal(resolved.r.ok, false, `${label} deveria ser rejeitado: HTTP ${resolved.r.status} ${JSON.stringify(resolved.body)}`); return resolved; };
const patch = (token, table, id, values) => request(token, `${table}?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(values) });
const remove = (token, table, id) => request(token, `${table}?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=representation" } });

test("Supabase real: MAI-65 financeiro, RLS e concorrencia", async () => {
  if (process.env.RUN_REAL_E2E !== "1") throw new Error("E2E real bloqueado: defina RUN_REAL_E2E=1 e use um Supabase de teste");
  const missing = required.filter((name) => !process.env[name]); if (missing.length) throw new Error(`E2E real sem configuração: ${missing.join(", ")}`);
  const [a, b] = await Promise.all([auth(process.env.E2E_USER_A_EMAIL, process.env.E2E_USER_A_PASSWORD), auth(process.env.E2E_USER_B_EMAIL, process.env.E2E_USER_B_PASSWORD)]); const aId = userId(a); const bId = userId(b); const date = new Date().toISOString().slice(0, 10);
  const place = (await ok(await request(a, "places", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: aId, nome: `E2E-${Date.now()}` }) }), "local A"))[0];
  const contact = (await ok(await request(a, "contacts", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: aId, nome: `E2E contato ${Date.now()}` }) }), "contato A"))[0];
  const createShift = async (token, values) => (await ok(await request(token, "shifts", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: userId(token), place_id: place.id, data: date, hora_inicio: "08:00", hora_fim: "09:00", valor_previsto: 100, status: "agendado", ...values }) }), "criar plantão"))[0];
  const realize = async (token, id) => { await ok(await patch(token, "shifts", id, { status: "realizado" }), "realizar plantão"); };
  const obligationFor = async (token, shiftId) => { const rows = await ok(await request(token, `obligations?shift_id=eq.${shiftId}&select=id,shift_id,valor_devido,data_prevista,responsavel_place_id,responsavel_contact_id`), "ler obrigação"); assert.equal(rows.length, 1); return rows[0]; };
  const pay = (token, obligation, value) => request(token, "rpc/register_payment", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ p_obligation_id: obligation, p_valor: value, p_data_pagamento: date }) });
  const saveShift = (token, values) => request(token, "rpc/save_shift_with_obligation", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(values) });
  const rpcRow = (body) => Array.isArray(body) ? body[0] : body;
  const concreteRpcShift = (body, label) => { const row = rpcRow(body); assert.ok(row && typeof row.id === "string" && row.id.length > 0, `${label}: RPC retornou shift inválido ${JSON.stringify(body)}`); return row; };
  const assertRejected42501 = async (result, label) => { const response = await rejected(result, label); assert.equal(response.body.code, "42501", `${label}: privilegio inesperado`); return response; };
  const assertRejected23514 = async (result, label) => { const response = await rejected(result, label); assert.equal(response.body.code, "23514", `${label}: código SQL inesperado`); return response; };

  const invalidScheduledKey = `mai65-invalid-scheduled-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await assertRejected23514(saveShift(a, { p_shift_id: null, p_place_id: place.id, p_data: date, p_hora_inicio: "05:00", p_hora_fim: "05:30", p_valor_previsto: 50, p_status: "agendado", p_data_prevista: "2030-09-10", p_responsavel_place_id: place.id, p_responsavel_contact_id: null, p_idempotency_key: invalidScheduledKey }), "criação agendada com obligation inválida");
  const scheduledKey = `mai65-scheduled-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const scheduledInput = { p_shift_id: null, p_place_id: place.id, p_data: date, p_hora_inicio: "05:30", p_hora_fim: "06:00", p_valor_previsto: 50, p_status: "agendado", p_data_prevista: null, p_responsavel_place_id: null, p_responsavel_contact_id: null, p_idempotency_key: scheduledKey };
  const scheduledCreated = concreteRpcShift(await ok(await saveShift(a, scheduledInput), "criação agendada idempotente"), "criação agendada idempotente");
  await assertRejected23514(saveShift(a, { ...scheduledInput, p_data_prevista: "2030-09-10" }), "retry agendado com obligation divergente");
  assert.equal((await request(a, `shifts?id=eq.${scheduledCreated.id}&select=id`)).body.length, 1, "retry inválido não deve duplicar shift agendado");

  const creationKey = `mai65-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creationInput = { p_shift_id: null, p_place_id: place.id, p_data: date, p_hora_inicio: "06:00", p_hora_fim: "07:00", p_valor_previsto: 80, p_status: "realizado", p_data_prevista: "2030-09-11", p_responsavel_place_id: place.id, p_responsavel_contact_id: null, p_idempotency_key: creationKey };
  const createdFirst = concreteRpcShift(await ok(await saveShift(a, creationInput), "criação RPC idempotente inicial"), "criação RPC idempotente inicial");
  const createdRetry = concreteRpcShift(await ok(await saveShift(a, creationInput), "retry de criação RPC idempotente"), "retry de criação RPC idempotente");
  assert.equal(createdRetry.id, createdFirst.id, "retry de criação deve retornar o mesmo shift");
  assert.equal((await request(a, `shifts?user_id=eq.${aId}&idempotency_key=eq.${encodeURIComponent(creationKey)}&select=id`)).body.length, 1, "chave deve produzir um shift");
  assert.equal((await request(a, `obligations?shift_id=eq.${createdFirst.id}&select=id`)).body.length, 1, "chave deve produzir uma obligation");
  const assertIdempotencyMismatch = async (values, label) => { const result = await rejected(saveShift(a, { ...creationInput, ...values }), label); assert.equal(result.body.code, "23514", `${label}: código SQL inesperado`); };
  await assertIdempotencyMismatch({ p_data_prevista: "2030-09-12" }, "retry com data prevista divergente");
  await assertIdempotencyMismatch({ p_responsavel_place_id: null, p_responsavel_contact_id: contact.id }, "retry com responsável divergente");
  await assertIdempotencyMismatch({ p_valor_previsto: 81 }, "retry com valor da obligation divergente");

  const editableShift = await createShift(a, { data: "2020-01-01" }); await realize(a, editableShift.id); const editable = await obligationFor(a, editableShift.id);
  await assertRejected42501(patch(a, "shifts", editableShift.id, { valor_previsto: 999 }), "PATCH direto de valor realizado sem privilegio");
  assert.equal(Number((await (await request(a, `shifts?id=eq.${editableShift.id}&select=valor_previsto`)).body)[0].valor_previsto), 100);
  await assertRejected42501(patch(a, "obligations", editable.id, { valor_devido: 120 }), "PATCH direto de obligation 100-120 sem privilegio");
  await assertRejected42501(patch(a, "obligations", editable.id, { valor_devido: null }), "PATCH direto de obligation para NULL sem privilegio");
  assert.equal(Number((await (await request(a, `shifts?id=eq.${editableShift.id}&select=valor_previsto`)).body)[0].valor_previsto), 100);
  assert.equal(Number((await obligationFor(a, editableShift.id)).valor_devido), 100);
  await ok(await patch(a, "obligations", editable.id, { data_prevista: "2030-09-10", responsavel_place_id: null, responsavel_contact_id: contact.id }), "edicao de data prevista e responsavel sem mudar valor");
  assert.equal(Number((await obligationFor(a, editableShift.id)).valor_devido), 100);
  assert.equal(Number((await (await request(a, `shifts?id=eq.${editableShift.id}&select=valor_previsto`)).body)[0].valor_previsto), 100);
  const rpcInput = { p_shift_id: editableShift.id, p_place_id: place.id, p_data: "2020-01-01", p_hora_inicio: "08:00", p_hora_fim: "09:00", p_valor_previsto: 120, p_status: "realizado", p_data_prevista: "2030-09-10", p_responsavel_place_id: null, p_responsavel_contact_id: contact.id };
  await ok(await saveShift(a, rpcInput), "retry RPC financeiro inicial"); await ok(await saveShift(a, rpcInput), "retry RPC financeiro idempotente"); assert.equal((await request(a, `obligations?shift_id=eq.${editableShift.id}&select=id`)).body.length, 1);
  assert.equal(Number((await (await request(a, `shifts?id=eq.${editableShift.id}&select=valor_previsto`)).body)[0].valor_previsto), 120);
  assert.equal(Number((await obligationFor(a, editableShift.id)).valor_devido), 120);
  const otherShift = await createShift(a, { hora_inicio: "10:00", hora_fim: "11:00" }); await realize(a, otherShift.id);
  await rejected(patch(a, "obligations", editable.id, { shift_id: otherShift.id }), "troca direta de shift_id"); assert.equal((await obligationFor(a, editableShift.id)).shift_id, editableShift.id);
  await rejected(remove(a, "obligations", editable.id), "DELETE direto enquanto realizado"); assert.equal((await obligationFor(a, editableShift.id)).id, editable.id);
  await rejected(remove(a, "shifts", editableShift.id), "DELETE direto de shift realizado"); assert.equal((await obligationFor(a, editableShift.id)).id, editable.id);
  await assertRejected42501(patch(b, "obligations", editable.id, { valor_devido: 999 }), "B sem privilegio em coluna financeira de A");
  const bObligationDelete = await remove(b, "obligations", editable.id); assert.equal(bObligationDelete.r.ok, true); assert.deepEqual(bObligationDelete.body, [], "RLS B não remove obligation A");
  const bReversal = await patch(b, "shifts", editableShift.id, { status: "cancelado" }); assert.equal(bReversal.r.ok, true); assert.deepEqual(bReversal.body, [], "RLS B não reverte shift A");
  const editableAfterB = (await (await request(a, `shifts?id=eq.${editableShift.id}&select=status,valor_previsto`)).body)[0]; assert.deepEqual(editableAfterB, { status: "realizado", valor_previsto: 120 }); assert.equal((await obligationFor(a, editableShift.id)).id, editable.id);

  const incompatible = await createShift(a, { hora_inicio: "12:00", hora_fim: "13:00" });
  await rejected(request(a, "obligations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: aId, shift_id: incompatible.id, valor_devido: 10, data_prevista: date, responsavel_place_id: place.id }) }), "criação em plantão agendado");
  await rejected(patch(a, "obligations", editable.id, { shift_id: incompatible.id }), "reassociação incompatível");

  const reversible = await createShift(a, { hora_inicio: "14:00", hora_fim: "15:00" }); await realize(a, reversible.id); const reversibleObligation = await obligationFor(a, reversible.id);
  await ok(await patch(a, "shifts", reversible.id, { status: "agendado" }), "reverter sem pagamento"); assert.deepEqual(await ok(await request(a, `obligations?id=eq.${reversibleObligation.id}&select=id`, {}), "confirmar remoção atômica"), []);

  const paid = await createShift(a, { hora_inicio: "16:00", hora_fim: "17:00" }); await realize(a, paid.id); const paidObligation = await obligationFor(a, paid.id); const partial = await ok(await pay(a, paidObligation.id, 40), "pagamento parcial");
  await rejected(patch(a, "shifts", paid.id, { valor_previsto: 999 }), "PATCH direto de valor em realizado");
  await rejected(patch(a, "obligations", paidObligation.id, { valor_devido: 30 }), "valor abaixo do recebido"); await rejected(patch(a, "shifts", paid.id, { status: "cancelado" }), "reversão com pagamento"); const finalPayment = await ok(await pay(a, paidObligation.id, 60), "pagamento restante"); await rejected(await pay(a, paidObligation.id, 1), "overpayment"); await ok(await patch(a, "payments", partial.id, { status: "cancelado" }), "cancelamento lógico parcial"); await ok(await patch(a, "payments", finalPayment.id, { status: "cancelado" }), "cancelamento lógico total"); await rejected(patch(a, "shifts", paid.id, { status: "cancelado" }), "reversão após todos cancelados com histórico"); assert.equal((await (await request(a, `shifts?id=eq.${paid.id}&select=status`)).body)[0].status, "realizado"); assert.equal((await obligationFor(a, paid.id)).id, paidObligation.id);
  const paidRpcBase = { p_shift_id: paid.id, p_place_id: place.id, p_data: date, p_hora_inicio: "16:00", p_hora_fim: "17:00", p_status: "realizado", p_data_prevista: date, p_responsavel_place_id: place.id, p_responsavel_contact_id: null };
  await ok(await pay(a, paidObligation.id, 30), "pagamento para piso RPC");
  await ok(await saveShift(a, { ...paidRpcBase, p_valor_previsto: 120 }), "RPC com valor novo acima do recebido");
  assert.equal(Number((await obligationFor(a, paid.id)).valor_devido), 120);
  await assertRejected23514(saveShift(a, { ...paidRpcBase, p_valor_previsto: 10 }), "RPC com valor novo abaixo do recebido rejeita");
  assert.equal(Number((await obligationFor(a, paid.id)).valor_devido), 120);
  const history = await ok(await request(a, `payments?obligation_id=eq.${paidObligation.id}&select=id,valor,status&order=valor`), "histórico"); assert.deepEqual(history.map(({ valor, status }) => [Number(valor), status]), [[30, "registrado"], [40, "cancelado"], [60, "cancelado"]]);

  assert.deepEqual(await ok(await request(b, `places?id=eq.${place.id}&select=id`), "RLS B local"), []); assert.deepEqual(await ok(await request(b, `shifts?id=eq.${paid.id}&select=id`), "RLS B plantão"), []); assert.deepEqual(await ok(await request(b, `obligations?id=eq.${paidObligation.id}&select=id`), "RLS B obrigação"), []); assert.deepEqual(await ok(await request(b, `payments?obligation_id=eq.${paidObligation.id}&select=id`), "RLS B pagamento"), []);
  await assertRejected42501(patch(b, "shifts", paid.id, { valor_previsto: 999 }), "B sem privilegio em valor de A"); await rejected(pay(b, paidObligation.id, 1), "RPC cruzada"); await rejected(request(b, "shifts", { method: "POST", body: JSON.stringify({ user_id: bId, place_id: place.id, data: date, hora_inicio: "18:00", hora_fim: "19:00", valor_previsto: 1 }) }), "criação com local A");

  const concurrent = await createShift(a, { hora_inicio: "20:00", hora_fim: "21:00" }); await realize(a, concurrent.id); const concurrentObligation = await obligationFor(a, concurrent.id); const concurrentResults = await Promise.all([pay(a, concurrentObligation.id, 60), pay(a, concurrentObligation.id, 60)]); assert.equal(concurrentResults.filter(({ r }) => r.ok).length, 1, "corrida aceitou ambos"); assert.equal(concurrentResults.filter(({ r }) => !r.ok).length, 1, "corrida rejeitou ambos"); const concurrentPayment = concurrentResults.find(({ r }) => r.ok).body; const balance = await ok(await request(a, `obligations_with_balance?id=eq.${concurrentObligation.id}&select=saldo`), "saldo concorrente"); assert.equal(Number(balance[0].saldo), 40); await ok(await patch(a, "payments", concurrentPayment.id, { status: "cancelado" }), "cancelar concorrente");
});
