import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPaymentDateNotFuture,
  bahiaTodayIso,
  isPaymentDateInFuture,
  summarizeSettledPayments,
} from "../src/lib/obligations/financial.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260930000000_payment_future_date_guard.sql");
const DAL = fs.readFileSync(path.join(ROOT, "src", "lib", "payments", "index.ts"), "utf8");
const UI = fs.readFileSync(path.join(ROOT, "src", "components", "payments", "payments-page.tsx"), "utf8");
const SQL = fs.readFileSync(MIGRATION, "utf8");

const NOON_BAHIA = new Date("2026-09-15T12:00:00-03:00");
const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);
};

describe("MAI-140: pagamento recebido nao aceita data futura (America/Bahia)", () => {
  test("1. rejeita data futura e aceita hoje/passado no servico", () => {
    const today = bahiaTodayIso(NOON_BAHIA);
    const future = addDays(today, 1);
    const past = addDays(today, -1);
    assert.equal(isPaymentDateInFuture(future, NOON_BAHIA), true);
    assert.equal(isPaymentDateInFuture(today, NOON_BAHIA), false);
    assert.equal(isPaymentDateInFuture(past, NOON_BAHIA), false);
    assert.throws(() => assertPaymentDateNotFuture(future, NOON_BAHIA), /futura/);
    assert.doesNotThrow(() => assertPaymentDateNotFuture(today, NOON_BAHIA));
    assert.doesNotThrow(() => assertPaymentDateNotFuture(past, NOON_BAHIA));
    assert.throws(() => assertPaymentDateNotFuture("", NOON_BAHIA), /Informe/);
  });

  test("2. virada de fuso America/Bahia: 23h59 ainda e hoje, 00h vira amanha", () => {
    // 2026-09-16T02:59Z ainda e 2026-09-15 na Bahia (UTC-3); 03:00Z ja e dia 16.
    const beforeMidnight = new Date("2026-09-16T02:59:00Z");
    const afterMidnight = new Date("2026-09-16T03:00:00Z");
    assert.equal(bahiaTodayIso(beforeMidnight), "2026-09-15");
    assert.equal(bahiaTodayIso(afterMidnight), "2026-09-16");
    assert.equal(isPaymentDateInFuture("2026-09-16", beforeMidnight), true);
    assert.equal(isPaymentDateInFuture("2026-09-16", afterMidnight), false);
    assert.equal(isPaymentDateInFuture("2026-09-15", beforeMidnight), false);
  });

  test("3. pagamentos parciais: passado quita parcial, futuro nao abate saldo", () => {
    const today = bahiaTodayIso(NOON_BAHIA);
    const past = addDays(today, -5);
    const future = addDays(today, 3);
    const full = summarizeSettledPayments(1000, [
      { valor: 400, data_pagamento: past, status: "registrado" },
      { valor: 600, data_pagamento: future, status: "registrado" },
    ], NOON_BAHIA);
    assert.deepEqual(full, { expected: 1000, received: 400, balance: 600 });
    const partial = summarizeSettledPayments(1000, [
      { valor: 250, data_pagamento: past, status: "registrado" },
      { valor: 250, data_pagamento: today, status: "registrado" },
    ], NOON_BAHIA);
    assert.deepEqual(partial, { expected: 1000, received: 500, balance: 500 });
    const cancelledIgnored = summarizeSettledPayments(1000, [
      { valor: 1000, data_pagamento: past, status: "cancelado" },
    ], NOON_BAHIA);
    assert.deepEqual(cancelledIgnored, { expected: 1000, received: 0, balance: 1000 });
  });

  test("4. saldo e total recebido nao contam entradas futuras como quitadas", () => {
    const today = bahiaTodayIso(NOON_BAHIA);
    const future = addDays(today, 1);
    const past = addDays(today, -2);
    const rows = [
      { valorDevido: 800, payments: [{ valor: 800, data_pagamento: past, status: "registrado" }] },
      { valorDevido: 1200, payments: [{ valor: 1200, data_pagamento: future, status: "registrado" }] },
    ];
    const totals = rows.reduce(
      (acc, r) => {
        const s = summarizeSettledPayments(r.valorDevido, r.payments, NOON_BAHIA);
        return { received: acc.received + s.received, balance: acc.balance + s.balance };
      },
      { received: 0, balance: 0 },
    );
    assert.equal(totals.received, 800);
    assert.equal(totals.balance, 1200);
    // Obrigacao com apenas pagamento futuro segue em aberto (nao quitada).
    const onlyFuture = summarizeSettledPayments(1200, rows[1].payments, NOON_BAHIA);
    assert.equal(onlyFuture.balance, 1200);
    assert.equal(onlyFuture.balance === 0, false);
  });

  test("5. RPC e trigger bloqueiam data futura no fuso America/Bahia", () => {
    assert.ok(fs.existsSync(MIGRATION), "migration MAI-140 deve existir");
    assert.match(SQL, /America\/Bahia/);
    assert.match(SQL, /register_payment/);
    assert.match(SQL, /validate_payment_financial_integrity/);
    assert.match(SQL, /Data de recebimento nao pode ser futura/);
    assert.match(SQL, /23514/);
    assert.match(SQL, /p_data_pagamento > \(now\(\) at time zone 'America\/Bahia'\)::date/);
    assert.match(SQL, /new\.data_pagamento > \(now\(\) at time zone 'America\/Bahia'\)::date/);
    assert.match(SQL, /data_prevista/);
    // View deriva saldo apenas de recebimentos quitados (data <= hoje Bahia).
    assert.match(SQL, /p\.data_pagamento <= \(now\(\) at time zone 'America\/Bahia'\)::date/);
  });

  test("6. DAL valida antes da RPC e UI trava data futura", () => {
    assert.match(DAL, /assertPaymentDateNotFuture/);
    assert.match(DAL, /\.rpc\("register_payment"/);
    assert.match(UI, /max=\{bahiaTodayIso\(\)\}/);
    assert.match(UI, /n.o pode ser futura/);
  });
});
