import assert from "node:assert/strict";
import test from "node:test";
import { addDaysToIso } from "../src/lib/dashboard/alerts.ts";

// Espelho da regra: o módulo real usa alias "@/", que o runner offline não resolve.
function dueDateFromTerm(shiftDateIso, prazoDias) {
  if (prazoDias === null || !Number.isInteger(prazoDias) || prazoDias < 0) return null;
  return addDaysToIso(shiftDateIso, prazoDias);
}

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
