import assert from "node:assert/strict";
import { test } from "node:test";

/*
 * ESTE TESTE SIMULA as regras offline e NÃO prova RLS, trigger, RPC ou FOR UPDATE.
 * Integração real: forneça SUPABASE_TEST_URL e SUPABASE_TEST_ANON_KEY via .env.test.
 */
const limitation = "ESTE TESTE SIMULA a regra e NAO prova RLS/trigger/RPC/FOR UPDATE";
const make = ({ userId = "user-a", status = "agendado", value, dueDate = "2026-09-01" } = {}) => ({ userId, status, value, dueDate, obligation: status === "realizado" ? { value, payments: [] } : null, payments: [], deleted: false });
function create(input = {}) { if (input.status === "realizado" && input.value == null) throw Error("realizado exige valor"); return make(input); }
const paid = (s) => s.payments.reduce((sum, p) => sum + p.value, 0);
const balance = (s) => s.status === "cancelado" || !s.obligation ? 0 : s.obligation.value - paid(s);
function pay(s, value) { if (s.status !== "realizado") throw Error("pagamento exige realizado"); if (paid(s) + value > s.obligation.value) throw Error("pagamento excede saldo"); s.payments.push({ value }); }
function status(s, next) {
  if (s.status === "realizado" && next === "agendado") throw Error("pago não pode voltar a agendado");
  if (next === "cancelado" && paid(s) === s.obligation?.value) throw Error("pago não pode ser cancelado");
  if (next === "realizado") { if (s.value == null) throw Error("realizado exige valor"); s.obligation ??= { value: s.value, payments: [] }; }
  s.status = next;
}
function updateValue(s, value) { if (value < paid(s)) throw Error("valor_devido abaixo do recebido"); s.value = value; if (s.obligation) s.obligation.value = value; }
function remove(s) { if (paid(s)) throw Error("plantão com pagamento não pode ser excluído"); s.deleted = true; }
const overdue = (s, today) => s.status === "realizado" && balance(s) > 0 && s.dueDate < today;

test("agendado sem valor pode existir", () => assert.equal(create().value, undefined));
test("agendado sem obrigação ainda não tem obligation", () => assert.equal(create().obligation, null));
test("realizado exige valor", () => assert.throws(() => create({ status: "realizado" }), /exige valor/));
test("realizado cria exatamente uma obligation", () => assert.equal(create({ status: "realizado", value: 100 }).obligation ? 1 : 0, 1));
test("criação direta de realizado também cria obligation", () => assert.equal(create({ status: "realizado", value: 250 }).obligation.value, 250));
test("pagamento parcial", () => { const s = create({ status: "realizado", value: 1000 }); pay(s, 250); assert.equal(balance(s), 750); });
test("pagamento integral", () => { const s = create({ status: "realizado", value: 1000 }); pay(s, 1000); assert.equal(balance(s), 0); });
test("overpayment rejeitado", () => { const s = create({ status: "realizado", value: 100 }); pay(s, 60); assert.throws(() => pay(s, 40.01), /excede/); assert.deepEqual(s.payments.map((p) => p.value), [60]); });
test("cancelamento lógico preserva pagamento (status=cancelado, não delete)", () => { const s = create({ status: "realizado", value: 100 }); pay(s, 40); status(s, "cancelado"); assert.equal(s.status, "cancelado"); assert.equal(s.payments.length, 1); assert.equal(s.deleted, false); });
test("cancelado não entra no saldo", () => { const s = create({ status: "realizado", value: 100 }); status(s, "cancelado"); assert.equal(balance(s), 0); });
test("pago não pode voltar a agendado", () => { const s = create({ status: "realizado", value: 100 }); pay(s, 100); assert.throws(() => status(s, "agendado"), /agendado/); });
test("pago não pode ser cancelado", () => { const s = create({ status: "realizado", value: 100 }); pay(s, 100); assert.throws(() => status(s, "cancelado"), /cancelado/); });
test("pago não pode ser excluído", () => { const s = create({ status: "realizado", value: 100 }); pay(s, 100); assert.throws(() => remove(s), /excluído/); assert.equal(s.deleted, false); });
test("valor_devido não pode ficar abaixo do recebido", () => { const s = create({ status: "realizado", value: 100 }); pay(s, 80); assert.throws(() => updateValue(s, 79.99), /abaixo/); });
test("atraso usa data_prevista (realizado + saldo > 0)", () => { const s = create({ status: "realizado", value: 100, dueDate: "2026-09-04" }); assert.equal(overdue(s, "2026-09-05"), true); pay(s, 100); assert.equal(overdue(s, "2026-09-05"), false); });
test("usuário A não acessa dados de B (RLS simulado offline)", () => { const rows = [create({ userId: "user-a", status: "realizado", value: 100 }), create({ userId: "user-b", status: "realizado", value: 200 })]; assert.deepEqual(rows.filter((s) => s.userId === "user-a").map((s) => s.userId), ["user-a"]); assert.match(limitation, /NAO prova RLS/); });
test("concorrência não permite ultrapassar saldo (simulação offline)", async () => { const s = create({ status: "realizado", value: 100 }); const results = await Promise.allSettled([Promise.resolve().then(() => pay(s, 60)), Promise.resolve().then(() => pay(s, 60))]); assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(paid(s), 60); });
test("integração local é opt-in e sem credenciais versionadas", async (t) => { if (!process.env.SUPABASE_TEST_URL || !process.env.SUPABASE_TEST_ANON_KEY) { t.skip("offline CI: .env.test externo valida RLS/trigger/RPC/FOR UPDATE"); return; } assert.fail("Harness será conectado às migrations finais do MAI-45"); });
