import assert from "node:assert/strict";
import test from "node:test";
import { financialAmounts, isOverdue } from "../src/lib/obligations/financial.ts";

test("financial totals ignore obligations when a shift is scheduled or cancelled", () => {
  const obligation = { valor_devido: 100, saldo: 100 };
  assert.deepEqual(financialAmounts("realizado", obligation), { expected: 100, received: 0, balance: 100 });
  assert.deepEqual(financialAmounts("agendado", obligation), { expected: 0, received: 0, balance: 0 });
  assert.deepEqual(financialAmounts("cancelado", obligation), { expected: 0, received: 0, balance: 0 });
});

test("overdue starts the day after the due date", () => {
  assert.equal(isOverdue("2026-09-06", new Date("2026-09-06T12:00:00-03:00")), false);
  assert.equal(isOverdue("2026-09-06", new Date("2026-09-07T12:00:00-03:00")), true);
});
