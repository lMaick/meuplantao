import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_PLACES,
  ALL_PERIODS,
  currentMonthValue,
  isMonthValue,
  matchesPeriod,
  matchesPlace,
  matchesShift,
  normalizePeriod,
  normalizePlace,
  receivedLabel,
} from "../src/lib/finance-filters/index.ts";

test("periodo padrao e o mes atual (America/Bahia)", () => {
  const expected = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bahia",
    year: "numeric",
    month: "2-digit",
  }).format(new Date("2026-09-11T12:00:00-03:00"));
  assert.equal(currentMonthValue(new Date("2026-09-11T12:00:00-03:00")), expected);
  assert.match(currentMonthValue(), /^\d{4}-(0[1-9]|1[0-2])$/);
});

test("validacao e normalizacao de periodo", () => {
  assert.equal(isMonthValue("2026-09"), true);
  assert.equal(isMonthValue("2026-13"), false);
  assert.equal(isMonthValue("all"), false);
  assert.equal(normalizePeriod("2026-08"), "2026-08");
  assert.equal(normalizePeriod("all"), ALL_PERIODS);
  assert.equal(normalizePeriod("todos"), ALL_PERIODS);
  assert.equal(normalizePeriod(null, new Date("2026-01-15T12:00:00-03:00")), "2026-01");
});

test("filtro por periodo usa prefixo YYYY-MM da data", () => {
  assert.equal(matchesPeriod("2026-09-05", "2026-09"), true);
  assert.equal(matchesPeriod("2026-08-31", "2026-09"), false);
  assert.equal(matchesPeriod("2026-08-31", ALL_PERIODS), true);
  assert.equal(matchesPeriod("2026-12-01", "2026-09"), false);
});

test("filtro por local lista so o local do usuario sem vazar isolamento", () => {
  assert.equal(matchesPlace("place-a", ALL_PLACES), true);
  assert.equal(matchesPlace("place-a", "todos"), true);
  assert.equal(matchesPlace("place-a", "place-a"), true);
  assert.equal(matchesPlace("place-a", "place-b"), false);
  assert.equal(normalizePlace(null), ALL_PLACES);
  assert.equal(normalizePlace("todos"), ALL_PLACES);
});

test("filtro combinado de periodo e local", () => {
  const shift = { data: "2026-09-10", place_id: "place-a" };
  assert.equal(matchesShift(shift, "2026-09", "place-a"), true);
  assert.equal(matchesShift(shift, "2026-08", "place-a"), false);
  assert.equal(matchesShift(shift, "2026-09", "place-b"), false);
  assert.equal(matchesShift(shift, ALL_PERIODS, ALL_PLACES), true);
});

test("filtros nao alteram saldo nem status derivado", () => {
  const shifts = [
    { id: "s1", data: "2026-09-05", place_id: "place-a", status: "realizado" },
    { id: "s2", data: "2026-08-05", place_id: "place-a", status: "realizado" },
    { id: "s3", data: "2026-09-06", place_id: "place-b", status: "realizado" },
  ];
  const obligations = [
    { shift_id: "s1", valor_devido: 100, saldo: 100 },
    { shift_id: "s2", valor_devido: 200, saldo: 50 },
    { shift_id: "s3", valor_devido: 300, saldo: 300 },
  ];
  const due = (period, place) => {
    const realized = new Set(
      shifts.filter((s) => s.status === "realizado" && matchesShift(s, period, place)).map((s) => s.id),
    );
    return obligations
      .filter((o) => realized.has(o.shift_id))
      .reduce((sum, o) => sum + Math.max(0, Number(o.saldo ?? 0)), 0);
  };
  assert.equal(due("2026-09", "place-a"), 100);
  assert.equal(due("2026-09", ALL_PLACES), 400);
  assert.equal(due(ALL_PERIODS, "place-a"), 150);
  assert.equal(due(ALL_PERIODS, ALL_PLACES), 450);
  assert.deepEqual(obligations.map((o) => o.saldo), [100, 50, 300]);
});

test("rotulo do recebido acompanha o periodo sem expor dados", () => {
  assert.equal(receivedLabel(ALL_PERIODS), "Recebido (todos)");
  assert.match(receivedLabel("2026-09"), /^Recebido em /);
});
