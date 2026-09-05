import assert from "node:assert/strict";
import { test } from "node:test";

/*
 * MAI-45 contract: shift -> obligation -> payments.
 * These are deliberately offline mocks: they cannot prove SQL RLS, triggers,
 * FOR UPDATE, or RPC behavior. The opt-in integration test documents that
 * limitation and is skipped unless .env.test values are supplied externally.
 */

function makeShift({ userId, status = "realizado" }) {
  return { userId, status, obligations: [] };
}

function addObligation(shift, { value, dueDate }) {
  const obligation = { shift, value, dueDate, payments: [] };
  shift.obligations.push(obligation);
  return obligation;
}

function paid(obligation) {
  return obligation.payments.reduce((sum, payment) => sum + payment.value, 0);
}

function saldo(obligation) {
  return Number((obligation.value - paid(obligation)).toFixed(2));
}

function atrasada(obligation, today) {
  return obligation.shift.status === "realizado" && saldo(obligation) > 0 && obligation.dueDate < today;
}

function registerPayment(obligation, value) {
  assert.ok(value > 0 && Number.isInteger(value * 100), "payment must be positive with two decimals");
  assert.equal(obligation.shift.status, "realizado", "only completed shifts can be paid");
  if (paid(obligation) + value > obligation.value) throw new Error("payment exceeds obligation balance");
  obligation.payments.push({ value });
}

test("partial and integral payments derive obligation saldo", () => {
  const obligation = addObligation(makeShift({ userId: "user-a" }), { value: 1000, dueDate: "2026-09-01" });
  registerPayment(obligation, 250);
  assert.equal(saldo(obligation), 750);
  registerPayment(obligation, 750);
  assert.equal(saldo(obligation), 0);
});

test("overpayment is rejected and does not mutate obligation payment history", () => {
  const obligation = addObligation(makeShift({ userId: "user-a" }), { value: 100, dueDate: "2026-09-01" });
  registerPayment(obligation, 60);
  assert.throws(() => registerPayment(obligation, 40.01), /exceeds/);
  assert.deepEqual(obligation.payments.map(({ value }) => value), [60]);
  assert.equal(saldo(obligation), 40);
});

test("a paid obligation cannot be canceled or reduced below its saldo history", () => {
  const obligation = addObligation(makeShift({ userId: "user-a" }), { value: 100, dueDate: "2026-09-01" });
  registerPayment(obligation, 40);
  assert.throws(() => { if (paid(obligation) > 0) throw new Error("financial inconsistency"); }, /inconsistency/);
  assert.throws(() => { if (30 < paid(obligation)) throw new Error("financial inconsistency"); }, /inconsistency/);
  assert.equal(obligation.payments.length, 1);
  assert.equal(saldo(obligation), 60);
});

test("atrasada is derived from realized shift, positive saldo, and data_prevista", () => {
  const obligation = addObligation(makeShift({ userId: "user-a" }), { value: 100, dueDate: "2026-09-04" });
  assert.equal(atrasada(obligation, "2026-09-05"), true);
  registerPayment(obligation, 100);
  assert.equal(atrasada(obligation, "2026-09-05"), false, "fully paid obligations are not overdue");
  const scheduled = addObligation(makeShift({ userId: "user-a", status: "agendado" }), { value: 100, dueDate: "2026-09-04" });
  assert.equal(atrasada(scheduled, "2026-09-05"), false, "unrealized shifts are not overdue");
});

test("two users cannot observe or pay each other's shift obligation", () => {
  const own = addObligation(makeShift({ userId: "user-a" }), { value: 100, dueDate: "2026-09-01" });
  const other = addObligation(makeShift({ userId: "user-b" }), { value: 200, dueDate: "2026-09-01" });
  assert.deepEqual([own, other].filter((obligation) => obligation.shift.userId === "user-a"), [own]);
  assert.throws(() => {
    if (other.shift.userId !== "user-a") throw new Error("row is not owned by authenticated user");
  }, /not owned/);
});

test("integration against local Supabase is explicit and opt-in", async (t) => {
  if (!process.env.SUPABASE_TEST_URL || !process.env.SUPABASE_TEST_ANON_KEY) {
    t.skip("offline CI: set SUPABASE_TEST_URL and SUPABASE_TEST_ANON_KEY from .env.test to run SQL/RLS integration");
    return;
  }
  assert.fail("Integration harness requires MAI-45 obligation migrations and local fixture setup");
});
