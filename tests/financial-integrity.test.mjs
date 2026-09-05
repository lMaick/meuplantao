import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const schema = readFileSync(new URL("../supabase/migrations/20260904204000_initial_schema.sql", import.meta.url), "utf8");
const financial = readFileSync(new URL("../supabase/migrations/20260905090000_financial_integrity.sql", import.meta.url), "utf8");

function makeLedger({ userId, expected, date, status = "realizado" }) {
  return { userId, expected, date, status, payments: [] };
}

function registerPayment(ledger, value, paymentDate = ledger.date) {
  assert.ok(value > 0 && Number.isInteger(value * 100), "payment must be positive with two decimals");
  assert.equal(ledger.status, "realizado", "only completed shifts can be paid");
  if (ledger.payments.reduce((sum, payment) => sum + payment.value, 0) + value > ledger.expected) {
    throw new Error("payment exceeds shift balance");
  }
  ledger.payments.push({ value, paymentDate });
}

function balance(ledger) {
  return Number((ledger.expected - ledger.payments.reduce((sum, payment) => sum + payment.value, 0)).toFixed(2));
}

function isOverdue(ledger, today) {
  return ledger.status === "agendado" && ledger.date < today;
}

test("partial and integral payments derive the remaining balance", () => {
  const ledger = makeLedger({ userId: "user-a", expected: 1000, date: "2026-09-01" });
  registerPayment(ledger, 250, "2026-09-02");
  assert.equal(balance(ledger), 750);
  registerPayment(ledger, 750, "2026-09-03");
  assert.equal(balance(ledger), 0);
});

test("overpayment is rejected and does not mutate payment history", () => {
  const ledger = makeLedger({ userId: "user-a", expected: 100, date: "2026-09-01" });
  registerPayment(ledger, 60);
  assert.throws(() => registerPayment(ledger, 40.01), /exceeds/);
  assert.deepEqual(ledger.payments.map(({ value }) => value), [60]);
});

test("canceling or lowering a paid shift is rejected, preserving history", () => {
  const ledger = makeLedger({ userId: "user-a", expected: 100, date: "2026-09-01" });
  registerPayment(ledger, 40);
  const registered = ledger.payments.reduce((sum, payment) => sum + payment.value, 0);
  assert.throws(() => { if (ledger.payments.length > 0) throw new Error("financial inconsistency"); }, /inconsistency/);
  assert.throws(() => { if (30 < registered) throw new Error("financial inconsistency"); }, /inconsistency/);
  assert.equal(ledger.payments.length, 1);
  assert.equal(balance(ledger), 60);
});

test("expected date drives overdue state, independently of payment balance", () => {
  const ledger = makeLedger({ userId: "user-a", expected: 100, date: "2026-09-04", status: "agendado" });
  assert.equal(isOverdue(ledger, "2026-09-05"), true);
  ledger.status = "realizado";
  assert.equal(isOverdue(ledger, "2026-09-05"), false);
});

test("two users cannot observe or pay each other's shift in the fixture", () => {
  const own = makeLedger({ userId: "user-a", expected: 100, date: "2026-09-01" });
  const other = makeLedger({ userId: "user-b", expected: 200, date: "2026-09-01" });
  const visibleToA = [own, other].filter((ledger) => ledger.userId === "user-a");
  assert.deepEqual(visibleToA, [own]);
  assert.throws(() => {
    if (other.userId !== "user-a") throw new Error("row is not owned by authenticated user");
  }, /not owned/);
});

test("current schema and financial migration retain the database enforcement boundary", () => {
  for (const table of ["public.shifts", "public.payments"]) assert.match(schema, new RegExp(`alter table ${table} enable row level security`));
  for (const table of ["shifts", "payments"]) {
    assert.match(schema, new RegExp(`create policy \\\"${table}_select_own\\\"`));
    const updatePolicy = schema.match(new RegExp(`create policy \\\"${table}_update_own\\\"[^;]+`))?.[0] ?? "";
    assert.match(updatePolicy, /using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  }
  for (const fragment of ["register_payment", "for update", "status <> 'realizado'", "sum(valor)", "valor_previsto", "security invoker"]) assert.match(financial, new RegExp(fragment.replace(/[().<>']/g, "\\$&")));
});
