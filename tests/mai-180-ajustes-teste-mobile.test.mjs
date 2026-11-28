import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { isShiftFormDirty } from "../src/lib/shifts/form-dirty.ts";
import { SIGNUP_SUCCESS_GENERIC_MESSAGE } from "../src/lib/auth/password-policy.ts";

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const calendar = read("src/components/shifts/shift-calendar.tsx");
const payments = read("src/components/payments/payments-page.tsx");
const guard = read("src/lib/shifts/use-back-guard.ts");

const base = {
  placeId: "p1",
  data: "2026-11-09",
  horaInicio: "07:00",
  horaFim: "19:00",
  valor: "800",
  status: "agendado",
  responsibleType: "",
  responsibleId: "",
  dueDate: "",
  extraDates: [],
};

test("isShiftFormDirty: igual ao inicial nao e alterado", () => {
  assert.equal(isShiftFormDirty(base, { ...base }), false);
  assert.equal(isShiftFormDirty(base, { ...base, valor: " 800 " }), false);
});

test("isShiftFormDirty: qualquer campo alterado conta", () => {
  for (const patch of [
    { placeId: "p2" },
    { data: "2026-11-10" },
    { horaInicio: "08:00" },
    { horaFim: "20:00" },
    { valor: "900" },
    { status: "realizado" },
    { responsibleType: "local" },
    { responsibleId: "x" },
    { dueDate: "2026-12-01" },
  ]) {
    assert.equal(isShiftFormDirty(base, { ...base, ...patch }), true, JSON.stringify(patch));
  }
});

test("isShiftFormDirty: datas extras, retentativa de lote e subformulario contam", () => {
  assert.equal(isShiftFormDirty(base, { ...base, extraDates: ["2026-11-12"] }), true);
  assert.equal(isShiftFormDirty({ ...base, extraDates: ["a", "b"] }, { ...base, extraDates: ["b", "a"] }), false);
  assert.equal(isShiftFormDirty(base, { ...base }, { hasBulkRetry: true }), true);
  assert.equal(isShiftFormDirty(base, { ...base }, { hasOpenSubform: true }), true);
});

test("formulario de plantao: confirmacao propria, sem confirm() nativo para descartar", () => {
  assert.match(calendar, /Descartar alterações\?/);
  assert.match(calendar, />\s*Descartar\s*<\/Button>/);
  assert.match(calendar, />\s*Continuar editando\s*<\/Button>/);
  assert.match(calendar, /isShiftFormDirty\(/);
  assert.match(calendar, /useBackGuard\(dirty/);
  // clique fora passa pelo mesmo close() com confirmacao
  assert.match(calendar, /event\.target === event\.currentTarget/);
  // Descartar real e o unico caminho que chama o close do pai (que cancela as chaves)
  assert.match(calendar, /close: discardAndClose/);
  const nativeConfirms = calendar.match(/\bconfirm\(/g) ?? [];
  assert.equal(nativeConfirms.length, 1, "so o confirm existente de Excluir plantao");
});

test("calendario mantem contratos: saveShiftWithObligation, intent, sem escrita direta", () => {
  assert.match(calendar, /saveShiftWithObligation/);
  assert.match(calendar, /ShiftCreationIntent/);
  assert.match(calendar, /idempotency_key/);
  assert.doesNotMatch(calendar, /createShift\(/);
  assert.doesNotMatch(calendar, /updateShift\(/);
});

test("gesto de voltar: sentinela em history, popstate e limpeza sem entrada orfa", () => {
  assert.match(guard, /pushState/);
  assert.match(guard, /addEventListener\("popstate"/);
  assert.match(guard, /removeEventListener\("popstate"/);
  assert.match(guard, /history\.back\(\)/);
  // so remove a sentinela se ainda estiver no topo (nao desfaz navegacao do Next)
  assert.match(guard, /hasGuard\(window\.history\.state/);
});

test("rotulos acessiveis ligados por id mantendo name/type", () => {
  for (const [id, text] of [
    ["shift-data", "Data"],
    ["shift-hora-inicio", "Início"],
    ["shift-hora-fim", "Fim"],
    ["shift-valor", "Valor do plantão \\(R\\$\\)"],
    ["shift-data-prevista", "Data prevista"],
  ]) {
    assert.match(calendar, new RegExp(`<label htmlFor="${id}">${text}`));
    assert.match(calendar, new RegExp(`id="${id}"`));
  }
  assert.match(calendar, /<Input name="data" type="date"\s+id="shift-data"/);
  assert.match(calendar, /<Input\s+name="hora_inicio"\s+type="time"\s+id="shift-hora-inicio"/);
  assert.match(calendar, /<Input\s+name="data_prevista"\s+type="date"\s+id="shift-data-prevista"/);
});

test("textos: singular do contador e painel de datas extras", () => {
  assert.match(calendar, /=== 1 \? "plantão" : "plantões"/);
  assert.match(calendar, /"data extra marcada" : "datas extras marcadas"\} · máximo de \$\{max\}/);
  assert.doesNotMatch(calendar, /de \$\{max\} datas extras/);
});

test("mensagem pos-cadastro: texto novo, sem revelar se o e-mail existe", () => {
  assert.equal(
    SIGNUP_SUCCESS_GENERIC_MESSAGE,
    "Agora abra seu e-mail e toque no link de confirmação para ativar sua conta. Não chegou? Confira o spam. Se você já tem conta, é só entrar."
  );
  assert.doesNotMatch(SIGNUP_SUCCESS_GENERIC_MESSAGE, /se o cadastro foi aceito|já (existe|cadastrado)|e-mail já/i);
});

test("Receber: o botao do card so abre a confirmacao, nunca grava", () => {
  const open = payments.match(/function openPaymentModal\([\s\S]*?\n  }\n/);
  assert.ok(open);
  assert.doesNotMatch(open[0], /createPayment/);
  assert.match(payments, /onClick=\{\(\) => openPaymentModal\(row\)\}/);
  // so duas chamadas: modal (confirmar) e formulario rapido
  assert.equal((payments.match(/createPayment\(/g) ?? []).length, 2);
  const modalSubmit = payments.match(/async function handleModalSubmit[\s\S]*?\n  }\n/)[0];
  assert.match(modalSubmit, /value <= 0/);
  assert.match(modalSubmit, /value > modalRow\.balance/);
  assert.match(modalSubmit, /modalDate > bahiaTodayIso\(\)/);
  assert.match(modalSubmit, /modalSubmittingRef\.current/);
  assert.match(payments, /useState\(\(\) => bahiaTodayIso\(\)\)/);
  assert.match(payments, /setModalAmount\(row\.balance\.toFixed\(2\)\)|setModalAmount\(row\.balance > 0/);
});

test("Registrar desabilitado explica o que falta (aria-live + aria-describedby)", () => {
  assert.match(payments, /aria-describedby="inline-submit-hint"/);
  assert.match(payments, /id="inline-submit-hint"/);
  assert.match(payments, /aria-live="polite"/);
  assert.match(payments, /Informe o valor e a data do pagamento\./);
});
