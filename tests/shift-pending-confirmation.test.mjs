import assert from "node:assert/strict";
import test from "node:test";
import { listPendingConfirmations } from "../src/lib/shifts/pending-confirmation.ts";

const today = "2026-11-09";
const shift = (id, data, status = "agendado", hora_inicio = "07:00") => ({ id, data, status, hora_inicio });

test("inclui plantão agendado de ontem", () => {
  const result = listPendingConfirmations([shift("a", "2026-11-08")], today);
  assert.deepEqual(result.map((s) => s.id), ["a"]);
});

test("exclui hoje e futuro", () => {
  const result = listPendingConfirmations([shift("hoje", today), shift("amanha", "2026-11-10")], today);
  assert.deepEqual(result, []);
});

test("exclui realizado e cancelado", () => {
  const result = listPendingConfirmations(
    [shift("r", "2026-11-01", "realizado"), shift("c", "2026-11-02", "cancelado")],
    today
  );
  assert.deepEqual(result, []);
});

test("ordena do mais antigo para o mais novo, com horário como desempate", () => {
  const result = listPendingConfirmations(
    [
      shift("c", "2026-11-08"),
      shift("b2", "2026-11-03", "agendado", "19:00"),
      shift("b1", "2026-11-03", "agendado", "07:00"),
      shift("a", "2026-10-20"),
    ],
    today
  );
  assert.deepEqual(result.map((s) => s.id), ["a", "b1", "b2", "c"]);
});

test("não muta a lista original", () => {
  const input = [shift("b", "2026-11-05"), shift("a", "2026-11-01")];
  listPendingConfirmations(input, today);
  assert.deepEqual(input.map((s) => s.id), ["b", "a"]);
});
