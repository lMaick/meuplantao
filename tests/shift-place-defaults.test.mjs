import assert from "node:assert/strict";
import test from "node:test";
import { dueDateFromTerm, resolveRealizedDefaults } from "../src/lib/shifts/place-defaults.ts";

const place = { id: "local-1", valor_padrao: 1200, prazo_recebimento_dias: 45, responsavel_contact_id: null };

test("prazo soma dias corridos cruzando o mês", () => {
  assert.equal(dueDateFromTerm("2026-11-20", 45), "2027-01-04");
});

test("prazo zero vence no próprio dia do plantão", () => {
  assert.equal(dueDateFromTerm("2026-11-20", 0), "2026-11-20");
});

test("prazo ausente ou inválido não inventa data", () => {
  assert.equal(dueDateFromTerm("2026-11-20", null), null);
  assert.equal(dueDateFromTerm("2026-11-20", -1), null);
  assert.equal(dueDateFromTerm("2026-11-20", 1.5), null);
});

test("usa o padrão do local e o próprio local como responsável", () => {
  assert.deepEqual(resolveRealizedDefaults({ data: "2026-11-20", valor_previsto: null }, place), {
    valor: 1200, dataPrevista: "2027-01-04", responsavelTipo: "local", responsavelId: "local-1", completo: true,
  });
});

test("valor do plantão, mesmo zero, vence o padrão", () => {
  assert.equal(resolveRealizedDefaults({ data: "2026-11-20", valor_previsto: 0 }, place).valor, 0);
});

test("contato padrão tem prioridade como responsável", () => {
  const r = resolveRealizedDefaults({ data: "2026-11-20", valor_previsto: 900 }, { ...place, responsavel_contact_id: "c-1" });
  assert.equal(r.responsavelTipo, "contato");
  assert.equal(r.responsavelId, "c-1");
});

test("sem valor ou sem prazo não fica completo", () => {
  assert.equal(resolveRealizedDefaults({ data: "2026-11-20", valor_previsto: null }, { ...place, valor_padrao: null }).completo, false);
  assert.equal(resolveRealizedDefaults({ data: "2026-11-20", valor_previsto: 900 }, { ...place, prazo_recebimento_dias: null }).completo, false);
});
