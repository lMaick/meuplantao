import assert from "node:assert/strict";
import { test } from "node:test";

/*
 * ESTES TESTES SIMULAM o domínio offline. Eles NÃO provam RLS, triggers, RPC,
 * FOR UPDATE, constraints ou concorrência real do Postgres.
 * TODO: adicionar harness real contra Supabase/Postgres local, com configuração
 * externa (.env.test) e sem credenciais versionadas.
 */

const makeShift = ({ userId = "user-a", status = "agendado", valorDevido, dataPrevista = "2026-09-01" } = {}) => ({
  userId, status, obligation: status === "realizado" ? { valor_devido: valorDevido, payments: [] } : null,
  data_prevista: dataPrevista, deleted: false,
});

function createShift(input = {}) {
  if (input.status === "realizado" && input.valorDevido == null) throw Error("realizado exige valor");
  return makeShift(input);
}

const registered = (obligation) => obligation.payments.filter((payment) => payment.status === "registrado");
const received = (shift) => registered(shift.obligation).reduce((sum, payment) => sum + payment.valor, 0);
const saldo = (shift) => shift.status === "cancelado" || !shift.obligation ? 0 : shift.obligation.valor_devido - received(shift);

function registerPayment(shift, valor) {
  if (shift.status !== "realizado") throw Error("pagamento exige plantão realizado");
  if (received(shift) + valor > shift.obligation.valor_devido) throw Error("pagamento excede saldo");
  shift.obligation.payments.push({ valor, status: "registrado" });
}

function cancelPayment(shift, payment) {
  assert.equal(shift.obligation.payments.includes(payment), true);
  payment.status = "cancelado";
}

function transition(shift, nextStatus) {
  if (received(shift) > 0 && (nextStatus === "agendado" || nextStatus === "cancelado")) {
    throw Error("pagamento registrado impede transição");
  }
  if (nextStatus === "realizado") {
    if (shift.obligation == null) throw Error("realizado exige valor");
  }
  shift.status = nextStatus;
}

function updateValorDevido(shift, valorDevido) {
  if (valorDevido < received(shift)) throw Error("valor_devido abaixo do recebido");
  shift.obligation.valor_devido = valorDevido;
}

function removeShift(shift) {
  if (received(shift) > 0) throw Error("plantão com pagamento não pode ser excluído");
  shift.deleted = true;
}

const atrasado = (shift, hoje) => shift.status === "realizado" && saldo(shift) > 0 && shift.data_prevista < hoje;

test("agendado sem valor pode existir", () => assert.equal(createShift().obligation, null));
test("agendado sem obligation ainda não tem obrigação financeira", () => assert.equal(createShift().obligation, null));
test("realizado exige valor", () => assert.throws(() => createShift({ status: "realizado" }), /exige valor/));
test("realizado cria exatamente uma obligation", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); assert.ok(shift.obligation); assert.equal(shift.obligation.payments.length, 0); });
test("criação direta de realizado também cria obligation", () => assert.equal(createShift({ status: "realizado", valorDevido: 250 }).obligation.valor_devido, 250));
test("pagamento parcial reduz o saldo da obligation", () => { const shift = createShift({ status: "realizado", valorDevido: 1000 }); registerPayment(shift, 250); assert.equal(saldo(shift), 750); });
test("pagamento integral zera o saldo", () => { const shift = createShift({ status: "realizado", valorDevido: 1000 }); registerPayment(shift, 1000); assert.equal(saldo(shift), 0); });
test("overpayment é rejeitado sem alterar pagamentos", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 60); assert.throws(() => registerPayment(shift, 40.01), /excede/); assert.deepEqual(shift.obligation.payments.map((payment) => payment.valor), [60]); });
test("cancelamento lógico do pagamento preserva registro, ignora valor e aumenta saldo", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 40); const payment = shift.obligation.payments[0]; cancelPayment(shift, payment); assert.equal(payment.status, "cancelado"); assert.equal(shift.obligation.payments.length, 1); assert.equal(received(shift), 0); assert.equal(saldo(shift), 100); assert.equal(shift.status, "realizado"); });
test("cancelado não entra no saldo", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 100); cancelPayment(shift, shift.obligation.payments[0]); assert.equal(saldo(shift), 100); });
test("pagamento registrado parcial impede realizado->agendado", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 1); assert.throws(() => transition(shift, "agendado"), /impede/); });
test("pagamento registrado parcial impede realizado->cancelado", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 1); assert.throws(() => transition(shift, "cancelado"), /impede/); });
test("pagamento registrado parcial impede exclusão", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 1); assert.throws(() => removeShift(shift), /não pode ser excluído/); });
test("valor_devido não pode ficar abaixo do recebido", () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); registerPayment(shift, 80); assert.throws(() => updateValorDevido(shift, 79.99), /abaixo/); assert.equal(shift.obligation.valor_devido, 100); });
test("atraso usa data_prevista: vence em 05/09, atrasa em 06/09 e some após pagamento integral", () => { const shift = createShift({ status: "realizado", valorDevido: 100, dataPrevista: "2026-09-05" }); assert.equal(atrasado(shift, "2026-09-05"), false); assert.equal(atrasado(shift, "2026-09-06"), true); registerPayment(shift, 100); assert.equal(saldo(shift), 0); assert.equal(atrasado(shift, "2026-09-06"), false); });
test("usuário A não acessa dados de B (RLS simulado offline)", () => { const rows = [createShift({ userId: "user-a", status: "realizado", valorDevido: 100 }), createShift({ userId: "user-b", status: "realizado", valorDevido: 200 })]; assert.deepEqual(rows.filter((shift) => shift.userId === "user-a").map((shift) => shift.userId), ["user-a"]); });
test("concorrência não permite ultrapassar saldo (simulação offline)", async () => { const shift = createShift({ status: "realizado", valorDevido: 100 }); const results = await Promise.allSettled([Promise.resolve().then(() => registerPayment(shift, 60)), Promise.resolve().then(() => registerPayment(shift, 60))]); assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(received(shift), 60); });

test("integração Supabase/Postgres local: TODO, ainda não implementada", (t) => {
  t.skip("sem harness real; não executar assert.fail nem apresentar este teste como integração");
});
