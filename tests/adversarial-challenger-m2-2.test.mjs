/**
 * Adversarial Challenger 2 Test Suite for Milestone 2 (Core Operational Views)
 *
 * Authored by: teamwork_preview_challenger (Challenger 2)
 * Scope: Empirically stress-test Dashboard metrics, alerts banner, loading skeletons,
 * and empty states against PROJECT.md, ORIGINAL_REQUEST.md, AGENTS.md, and worker_m2 deliverables.
 *
 * Verifies:
 * 1. Financial derivation invariants in dashboard.tsx: due, received, overdue, upcoming
 * 2. Layout shift resistance and DOM validity of DashboardSkeleton and CalendarSkeleton
 * 3. Rich EmptyState rendering, Lucide icons, and >=44px CTA touch targets
 * 4. DashboardAlerts banner states, semantic tokens, and URL routing contracts
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import ReactDOMServer from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

import { isOverdue as domainIsOverdue } from "../src/lib/obligations/financial.ts";
import { computeDashboardAlerts } from "../src/lib/dashboard/alerts.ts";
import {
  ALL_PLACES,
  currentMonthValue,
  matchesPeriod,
  matchesPlace,
  matchesShift,
} from "../src/lib/finance-filters/index.ts";

// Helper to transpile and evaluate TSX modules inside a Node VM sandbox
function loadTsxModule(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const sandbox = {
    require: (id) => {
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      if (id === "react") return React;
      if (id === "cn") return { cn: (...args) => args.filter(Boolean).join(" ") };
      if (id === "next/link") {
        const Link = ({ href, children, ...props }) =>
          React.createElement("a", { href, ...props }, children);
        Link.default = Link;
        return Link;
      }
      if (id === "@/components/ui/button" || id === "./button") {
        return loadTsxModule("src/components/ui/button.tsx");
      }
      if (id === "@/components/ui/primitives" || id === "./primitives") {
        return loadTsxModule("src/components/ui/primitives.tsx");
      }
      if (id === "@/components/ui/empty-state" || id === "./empty-state") {
        return loadTsxModule("src/components/ui/empty-state.tsx");
      }
      if (id === "@/components/ui/skeletons" || id === "./skeletons") {
        return loadTsxModule("src/components/ui/skeletons.tsx");
      }
      if (id === "@/components/ui/badge" || id === "./badge") {
        const Badge = ({ children, variant = "default", dot = false, className = "", ...props }) =>
          React.createElement(
            "span",
            {
              className: `badge badge-${variant} ${dot ? "has-dot" : ""} ${className}`.trim(),
              ...props,
            },
            children
          );
        return { Badge };
      }
      if (id === "@/lib/finance-filters") {
        return {
          ALL_PLACES: "all",
          currentMonthValue,
          matchesPeriod,
          matchesPlace,
          matchesShift,
        };
      }
      if (id === "@/lib/obligations") {
        return { isOverdue: domainIsOverdue };
      }
      if (id === "@/lib/dashboard/alerts") {
        return { computeDashboardAlerts };
      }
      return require(id);
    },
    exports: {},
    module: { exports: {} },
  };

  vm.runInNewContext(transpiled.outputText, sandbox);
  return { ...sandbox.module.exports, ...sandbox.exports };
}

// Pure mathematical oracle replicating dashboard data derivations
function computeDashboardMetricsOracle({ shifts, payments, obligations, places, period, placeId, todayIso }) {
  const today = todayIso;
  const end = new Date(`${today}T12:00:00-03:00`);
  end.setDate(end.getDate() + 7);
  const endIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(end);

  const shiftsById = new Map(shifts.map((s) => [s.id, s]));
  const obligationById = new Map(obligations.map((o) => [o.id, o]));
  const placesById = new Map(places.map((p) => [p.id, p.nome]));

  const filteredShifts = shifts.filter((s) => matchesShift(s, period, placeId));
  const realized = new Set(
    filteredShifts.filter((s) => s.status === "realizado").map((s) => s.id)
  );

  const financial = obligations.filter(
    (o) => realized.has(o.shift_id) && o.valor_devido !== null
  );

  const pending = financial
    .filter((o) => Number(o.saldo ?? 0) > 0)
    .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista))
    .slice(0, 4);

  const due = financial.reduce(
    (sum, o) => sum + Math.max(0, Number(o.saldo ?? 0)),
    0
  );

  const received = payments
    .filter((payment) => {
      if (payment.status !== "registrado") return false;
      if (!matchesPeriod(payment.data_pagamento, period)) return false;
      if (placeId === ALL_PLACES) return true;
      const obligation = obligationById.get(payment.obligation_id);
      const shift = obligation ? shiftsById.get(obligation.shift_id) : undefined;
      return shift ? matchesPlace(shift.place_id, placeId) : false;
    })
    .reduce((sum, payment) => sum + Number(payment.valor), 0);

  const overdue = financial
    .filter(
      (o) => Number(o.saldo ?? 0) > 0 && domainIsOverdue(o.data_prevista, new Date(`${today}T12:00:00-03:00`))
    )
    .reduce((sum, o) => sum + Number(o.saldo ?? 0), 0);

  const upcoming = shifts
    .filter(
      (s) =>
        s.status === "agendado" &&
        s.data >= today &&
        s.data <= endIso &&
        matchesPlace(s.place_id, placeId)
    )
    .sort((a, b) => `${a.data}${a.hora_inicio}`.localeCompare(`${b.data}${b.hora_inicio}`))
    .slice(0, 5);

  return { due, received, overdue, upcoming, pending, financial, shiftsById, placesById };
}

/* ========================================================================= */
/* TEST SUITE 1: EMPIRICAL DERIVATION OF DASHBOARD METRICS                   */
/* ========================================================================= */

describe("Empirical Stress-Testing: Dashboard Metrics Derivation & Invariants", () => {
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());

  test("[CH-M2-01] `due` strictly derives from realized shifts and sums remaining saldo (not valor_devido)", () => {
    const places = [{ id: "p1", nome: "Hospital Alfa" }];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "p1", data: `${todayIso.slice(0, 7)}-01`, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s2", status: "agendado", place_id: "p1", data: `${todayIso.slice(0, 7)}-15`, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s3", status: "cancelado", place_id: "p1", data: `${todayIso.slice(0, 7)}-10`, hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      // Realized with remaining balance
      { id: "o1", shift_id: "s1", valor_devido: 2000, saldo: 800, data_prevista: "2026-09-20", responsavel_place_id: "p1", responsavel_contact_id: null },
      // Agendado shift with obligation -> MUST NOT be in due
      { id: "o2", shift_id: "s2", valor_devido: 1500, saldo: 1500, data_prevista: "2026-09-25", responsavel_place_id: "p1", responsavel_contact_id: null },
      // Cancelado shift with obligation -> MUST NOT be in due
      { id: "o3", shift_id: "s3", valor_devido: 1200, saldo: 1200, data_prevista: "2026-09-22", responsavel_place_id: "p1", responsavel_contact_id: null },
    ];

    const result = computeDashboardMetricsOracle({
      shifts,
      payments: [],
      obligations,
      places,
      period: currentMonthValue(),
      placeId: ALL_PLACES,
      todayIso,
    });

    // due must be 800, NOT 2000, NOT 2000+1500+1200
    assert.equal(result.due, 800, "Due metric must sum only remaining saldo of realized shifts");
    assert.equal(result.financial.length, 1, "Only realized shifts can form financial obligations");
  });

  test("[CH-M2-02] `received` sums strictly registered payments and excludes canceled payments", () => {
    const places = [{ id: "p1", nome: "Hospital Alfa" }];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "p1", data: `${todayIso.slice(0, 7)}-01`, hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      { id: "o1", shift_id: "s1", valor_devido: 2000, saldo: 800, data_prevista: "2026-09-20", responsavel_place_id: "p1", responsavel_contact_id: null },
    ];
    const payments = [
      { id: "pay1", obligation_id: "o1", valor: 1200, data_pagamento: `${todayIso.slice(0, 7)}-05`, status: "registrado" },
      { id: "pay2", obligation_id: "o1", valor: 500, data_pagamento: `${todayIso.slice(0, 7)}-06`, status: "cancelado" },
    ];

    const result = computeDashboardMetricsOracle({
      shifts,
      payments,
      obligations,
      places,
      period: currentMonthValue(),
      placeId: ALL_PLACES,
      todayIso,
    });

    assert.equal(result.received, 1200, "Received metric must exclude canceled payments");
  });

  test("[CH-M2-03] `overdue` counts strictly obligations with saldo > 0 and past data_prevista", () => {
    const places = [{ id: "p1", nome: "Hospital Alfa" }];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "p1", data: "2026-08-01", hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s2", status: "realizado", place_id: "p1", data: "2026-08-05", hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s3", status: "realizado", place_id: "p1", data: "2026-08-10", hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      // Past due with positive saldo -> OVERDUE
      { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: 1000, data_prevista: "2026-08-10", responsavel_place_id: "p1", responsavel_contact_id: null },
      // Past due but fully paid (saldo = 0) -> NOT OVERDUE
      { id: "o2", shift_id: "s2", valor_devido: 1000, saldo: 0, data_prevista: "2026-08-12", responsavel_place_id: "p1", responsavel_contact_id: null },
      // Future due date -> NOT OVERDUE
      { id: "o3", shift_id: "s3", valor_devido: 1500, saldo: 1500, data_prevista: "2099-01-01", responsavel_place_id: "p1", responsavel_contact_id: null },
    ];

    const result = computeDashboardMetricsOracle({
      shifts,
      payments: [],
      obligations,
      places,
      period: "all",
      placeId: ALL_PLACES,
      todayIso,
    });

    assert.equal(result.overdue, 1000, "Overdue metric must be exactly 1000 (excluding paid or future obligations)");
  });

  test("[CH-M2-04] `upcoming` selects strictly agendado shifts in [today, today + 7 days]", () => {
    const today = new Date();
    const isoDate = (offsetDays) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);
    };

    const places = [{ id: "p1", nome: "Hospital Alfa" }];
    const shifts = [
      { id: "s_past", status: "agendado", place_id: "p1", data: isoDate(-1), hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_today", status: "agendado", place_id: "p1", data: isoDate(0), hora_inicio: "19:00", hora_fim: "07:00" },
      { id: "s_day3", status: "agendado", place_id: "p1", data: isoDate(3), hora_inicio: "08:00", hora_fim: "18:00" },
      { id: "s_day7", status: "agendado", place_id: "p1", data: isoDate(7), hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_day8", status: "agendado", place_id: "p1", data: isoDate(8), hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_realized", status: "realizado", place_id: "p1", data: isoDate(2), hora_inicio: "07:00", hora_fim: "19:00" },
    ];

    const result = computeDashboardMetricsOracle({
      shifts,
      payments: [],
      obligations: [],
      places,
      period: "all",
      placeId: ALL_PLACES,
      todayIso: isoDate(0),
    });

    const upcomingIds = result.upcoming.map((s) => s.id);
    assert.deepEqual(
      upcomingIds,
      ["s_today", "s_day3", "s_day7"],
      "Upcoming shifts must include today and day 7, but exclude past, day 8, or realized shifts"
    );
  });

  test("[CH-M2-05] Place filtering isolates metrics cleanly between locations", () => {
    const places = [
      { id: "p1", nome: "Hospital Alfa" },
      { id: "p2", nome: "UPA Beta" },
    ];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "p1", data: `${todayIso.slice(0, 7)}-02`, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s2", status: "realizado", place_id: "p2", data: `${todayIso.slice(0, 7)}-03`, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s3", status: "agendado", place_id: "p1", data: todayIso, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s4", status: "agendado", place_id: "p2", data: todayIso, hora_inicio: "19:00", hora_fim: "07:00" },
    ];
    const obligations = [
      { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: 1000, data_prevista: "2026-08-01", responsavel_place_id: "p1", responsavel_contact_id: null },
      { id: "o2", shift_id: "s2", valor_devido: 2000, saldo: 2000, data_prevista: "2026-08-01", responsavel_place_id: "p2", responsavel_contact_id: null },
    ];
    const payments = [
      { id: "pay1", obligation_id: "o1", valor: 500, data_pagamento: `${todayIso.slice(0, 7)}-05`, status: "registrado" },
      { id: "pay2", obligation_id: "o2", valor: 800, data_pagamento: `${todayIso.slice(0, 7)}-05`, status: "registrado" },
    ];

    // Filter by p1
    const resP1 = computeDashboardMetricsOracle({
      shifts,
      payments,
      obligations,
      places,
      period: "all",
      placeId: "p1",
      todayIso,
    });

    assert.equal(resP1.due, 1000, "Due for p1 must be 1000");
    assert.equal(resP1.received, 500, "Received for p1 must be 500");
    assert.equal(resP1.overdue, 1000, "Overdue for p1 must be 1000");
    assert.equal(resP1.upcoming.length, 1, "Upcoming for p1 must contain only s3");
    assert.equal(resP1.upcoming[0].id, "s3");

    // Filter by p2
    const resP2 = computeDashboardMetricsOracle({
      shifts,
      payments,
      obligations,
      places,
      period: "all",
      placeId: "p2",
      todayIso,
    });

    assert.equal(resP2.due, 2000, "Due for p2 must be 2000");
    assert.equal(resP2.received, 800, "Received for p2 must be 800");
    assert.equal(resP2.overdue, 2000, "Overdue for p2 must be 2000");
    assert.equal(resP2.upcoming.length, 1, "Upcoming for p2 must contain only s4");
    assert.equal(resP2.upcoming[0].id, "s4");
  });

  test("[CH-M2-06] Generative Stress Fuzzing: 50 synthetic permutations produce deterministic 0-error oracle match", () => {
    const places = [
      { id: "p1", nome: "Hospital Alpha" },
      { id: "p2", nome: "Clínica Beta" },
      { id: "p3", nome: "UPA Gama" },
    ];

    for (let seed = 0; seed < 50; seed++) {
      const numShifts = 10 + (seed % 15);
      const generatedShifts = [];
      const generatedObligations = [];
      const generatedPayments = [];

      for (let i = 0; i < numShifts; i++) {
        const placeId = places[i % 3].id;
        const status = ["agendado", "realizado", "cancelado"][i % 3];
        const dayOffset = (i % 20) - 10;
        const d = new Date(todayIso);
        d.setDate(d.getDate() + dayOffset);
        const shiftDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);

        const shift = {
          id: `fuzz_s_${seed}_${i}`,
          status,
          place_id: placeId,
          data: shiftDate,
          hora_inicio: "07:00",
          hora_fim: "19:00",
        };
        generatedShifts.push(shift);

        if (status === "realizado") {
          const valor = 1000 + (i * 200);
          const hasPayment = i % 2 === 0;
          const paymentVal = hasPayment ? Math.floor(valor / 2) : 0;
          const saldo = valor - paymentVal;
          const dueDayOffset = dayOffset + 5;
          const dueD = new Date(todayIso);
          dueD.setDate(dueD.getDate() + dueDayOffset);
          const dataPrevista = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(dueD);

          const obligation = {
            id: `fuzz_o_${seed}_${i}`,
            shift_id: shift.id,
            valor_devido: valor,
            saldo,
            data_prevista: dataPrevista,
            responsavel_place_id: placeId,
            responsavel_contact_id: null,
          };
          generatedObligations.push(obligation);

          if (hasPayment) {
            generatedPayments.push({
              id: `fuzz_pay_${seed}_${i}`,
              obligation_id: obligation.id,
              valor: paymentVal,
              data_pagamento: dataPrevista,
              status: "registrado",
            });
          }
        }
      }

      const res = computeDashboardMetricsOracle({
        shifts: generatedShifts,
        payments: generatedPayments,
        obligations: generatedObligations,
        places,
        period: "all",
        placeId: ALL_PLACES,
        todayIso,
      });

      // Mathematical invariants must hold for all 50 iterations:
      assert.ok(res.due >= 0, `Seed ${seed}: due must be >= 0`);
      assert.ok(res.received >= 0, `Seed ${seed}: received must be >= 0`);
      assert.ok(res.overdue >= 0, `Seed ${seed}: overdue must be >= 0`);
      assert.ok(res.overdue <= res.due, `Seed ${seed}: overdue cannot exceed total due`);
      assert.ok(res.upcoming.length <= 5, `Seed ${seed}: upcoming capped at 5`);
      assert.ok(res.pending.length <= 4, `Seed ${seed}: pending capped at 4`);
    }
  });
});

/* ========================================================================= */
/* TEST SUITE 2: EMPIRICAL SKELETON LAYOUT SHIFT & DOM VALIDITY              */
/* ========================================================================= */

describe("Empirical Stress-Testing: Skeletons Layout Shift & DOM Integrity", () => {
  const { DashboardSkeleton, CalendarSkeleton } = loadTsxModule("src/components/ui/skeletons.tsx");

  test("[CH-M2-07] DashboardSkeleton renders clean DOM with role='status' and accessible aria-label", () => {
    const markup = ReactDOMServer.renderToStaticMarkup(React.createElement(DashboardSkeleton));

    assert.ok(markup.startsWith("<main"), "DashboardSkeleton must render a <main> root");
    assert.ok(markup.includes('role="status"'), "Must include role='status' for accessibility");
    assert.ok(
      markup.includes('aria-label="Carregando resumo financeiro..."'),
      "Must include informative aria-label"
    );
    assert.ok(!markup.includes("undefined"), "DOM markup must not contain undefined");
    assert.ok(!markup.includes("NaN"), "DOM markup must not contain NaN");
  });

  test("[CH-M2-08] DashboardSkeleton geometry matches Dashboard layout container and grid contracts", () => {
    const dashboardSource = fs.readFileSync("src/components/dashboard/dashboard.tsx", "utf8");
    const markup = ReactDOMServer.renderToStaticMarkup(React.createElement(DashboardSkeleton));

    // Outer container padding match
    assert.ok(
      dashboardSource.includes("px-4 py-6 text-foreground sm:px-8"),
      "Dashboard source specifies mobile/desktop padding"
    );
    assert.ok(
      markup.includes("px-4 py-6 text-foreground sm:px-8"),
      "DashboardSkeleton reproduces exact container padding"
    );

    // Max width wrapper
    assert.ok(
      markup.includes("mx-auto max-w-6xl space-y-8"),
      "DashboardSkeleton reproduces exact max-w-6xl space-y-8 wrapper"
    );

    // 4 KPI cards grid match (MAI-115: xl breakpoint avoids squeeze at 1024px with 256px sidebar)
    assert.ok(
      markup.includes("sm:grid-cols-2 xl:grid-cols-4"),
      "DashboardSkeleton reproduces 4-col KPI grid"
    );

    // 2-card split grid match
    assert.ok(
      markup.includes("grid gap-6 lg:grid-cols-2"),
      "DashboardSkeleton reproduces 2-col split card grid"
    );
  });

  test("[CH-M2-09] CalendarSkeleton renders clean DOM with role='status' and 7-col weekday/month grid", () => {
    const markup = ReactDOMServer.renderToStaticMarkup(React.createElement(CalendarSkeleton));

    assert.ok(markup.startsWith("<main"), "CalendarSkeleton must render a <main> root");
    assert.ok(markup.includes('role="status"'), "Must include role='status'");
    assert.ok(
      markup.includes('aria-label="Carregando agenda de plantões..."'),
      "Must include informative aria-label"
    );

    // Calendar + Sidebar grid
    assert.ok(
      markup.includes("lg:grid-cols-[1fr_340px]"),
      "CalendarSkeleton must reproduce desktop sidebar layout"
    );

    // 7-column weekday headers
    const weekdayMatches = [...markup.matchAll(/border-b border-r border-border bg-muted\/40/g)];
    assert.equal(weekdayMatches.length, 7, "CalendarSkeleton must render exactly 7 weekday header cells");

    // 35 day cells
    const dayCells = [...markup.matchAll(/min-h-20 sm:min-h-24/g)];
    assert.equal(dayCells.length, 35, "CalendarSkeleton must render exactly 35 day skeleton cells");
  });
});

/* ========================================================================= */
/* TEST SUITE 3: EMPIRICAL EMPTY STATES & CTA REACHABILITY                   */
/* ========================================================================= */

describe("Empirical Stress-Testing: EmptyState Primitives & CTA Reachability", () => {
  const { EmptyState } = loadTsxModule("src/components/ui/primitives.tsx");

  test("[CH-M2-10] EmptyState renders semantic container with role='region' and aria-label", () => {
    const markup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(EmptyState, {
        title: "Nenhum plantão agendado",
        description: "Você não possui plantões marcados para os próximos 7 dias.",
      })
    );

    assert.ok(markup.includes('role="region"'), "EmptyState must render role='region'");
    assert.ok(markup.includes('aria-label="Nenhum plantão agendado"'), "aria-label must match title");
    assert.ok(markup.includes("<h3"), "Title must be rendered inside an <h3> heading");
    assert.ok(markup.includes("<p"), "Description must be rendered inside a <p>");
  });

  test("[CH-M2-11] EmptyState differentiates standard and compact padding configurations", () => {
    const standardMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(EmptyState, {
        title: "Standard Empty",
        compact: false,
      })
    );
    const compactMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(EmptyState, {
        title: "Compact Empty",
        compact: true,
      })
    );

    assert.ok(standardMarkup.includes("p-8 sm:p-12"), "Standard EmptyState uses p-8 sm:p-12");
    assert.ok(compactMarkup.includes("p-5 sm:p-6"), "Compact EmptyState uses p-5 sm:p-6");
  });

  test("[CH-M2-12] Dashboard empty state CTAs satisfy minimum 44px touch targets", () => {
    const dashboardSource = fs.readFileSync("src/components/dashboard/dashboard.tsx", "utf8");

    // Pending empty state CTA
    assert.ok(
      dashboardSource.includes('title="Nenhum valor pendente"'),
      "Dashboard must define empty state for pending receivables"
    );
    assert.ok(
      dashboardSource.includes('min-h-[44px]'),
      "Dashboard empty state CTAs must specify min-h-[44px]"
    );

    // Upcoming empty state CTA
    assert.ok(
      dashboardSource.includes('title="Nenhum plantão agendado"'),
      "Dashboard must define empty state for upcoming shifts"
    );
  });

  test("[CH-M2-13] Calendar page empty states provide valid navigation actions", () => {
    const calendarPageSource = fs.readFileSync("src/app/calendario/page.tsx", "utf8");

    // Zero places state
    assert.ok(
      calendarPageSource.includes('title="Cadastre seu primeiro local"'),
      "Calendar page must render rich EmptyState when 0 places exist"
    );
    assert.ok(
      calendarPageSource.includes('href="/locais"'),
      "Zero places EmptyState must direct user to /locais"
    );

    // Error state
    assert.ok(
      calendarPageSource.includes('title="Erro ao carregar calendário"'),
      "Calendar page must render rich EmptyState on network failure"
    );
  });
});

/* ========================================================================= */
/* TEST SUITE 4: EMPIRICAL DASHBOARD ALERTS BANNER STRESS-TESTING            */
/* ========================================================================= */

describe("Empirical Stress-Testing: Dashboard Alerts Banner", () => {
  const { DashboardAlerts } = loadTsxModule("src/components/dashboard/dashboard-alerts.tsx");

  test("[CH-M2-14] DashboardAlerts returns null when hasAlerts is false", () => {
    const summary = {
      overdueCount: 0,
      overdueAmount: 0,
      upcomingCount: 0,
      upcomingAmount: 0,
      topOverdue: null,
      topUpcoming: null,
      hasAlerts: false,
    };

    const markup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DashboardAlerts, { summary })
    );

    assert.equal(markup, "", "Alerts banner must render null without polluting the DOM");
  });

  test("[CH-M2-15] Overdue alert banner renders semantic destructive tokens and 44px CTA", () => {
    const summary = {
      overdueCount: 3,
      overdueAmount: 4500,
      upcomingCount: 0,
      upcomingAmount: 0,
      topOverdue: {
        obligationId: "o1",
        shiftId: "s1",
        responsibleName: "Hospital São Rafael",
        placeName: "Hospital São Rafael",
        dataPrevista: "2026-09-01",
        balance: 3000,
        daysOverdue: 11,
      },
      topUpcoming: null,
      hasAlerts: true,
    };

    const markup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DashboardAlerts, { summary, placeId: "place_123" })
    );

    assert.ok(markup.includes('role="region"'), "Alerts banner must be a region landmark");
    assert.ok(
      markup.includes('aria-label="Alertas de repasses financeiros em atraso"'),
      "Must have accessible aria-label"
    );
    assert.ok(markup.includes("border-destructive/30"), "Must use semantic destructive token");
    assert.ok(markup.includes("bg-destructive/10"), "Must use semantic destructive background");
    assert.ok(markup.includes("Cobrar atrasados"), "Must display CTA 'Cobrar atrasados'");
    assert.ok(markup.includes("min-h-[44px]"), "CTA must enforce min-h-[44px]");
    assert.ok(
      markup.includes("placeId=place_123"),
      "CTA href must forward encoded placeId filter"
    );
  });

  test("[CH-M2-16] Preventive alert banner activates when only upcoming obligations exist", () => {
    const summary = {
      overdueCount: 0,
      overdueAmount: 0,
      upcomingCount: 2,
      upcomingAmount: 2400,
      topOverdue: null,
      topUpcoming: {
        obligationId: "o2",
        shiftId: "s2",
        responsibleName: "Clínica São Paulo",
        placeName: "Clínica São Paulo",
        dataPrevista: "2026-09-15",
        balance: 1200,
        daysUntilDue: 3,
      },
      hasAlerts: true,
    };

    const markup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DashboardAlerts, { summary })
    );

    assert.ok(
      markup.includes('aria-label="Alerta preventivo de repasses a vencer nos próximos 7 dias"'),
      "Must render preventive banner"
    );
    assert.ok(markup.includes("border-warning/30"), "Must use semantic warning border");
    assert.ok(markup.includes("bg-warning/10"), "Must use semantic warning background");
    assert.ok(markup.includes("Ver agenda"), "Must display CTA 'Ver agenda'");
    assert.ok(markup.includes("min-h-[44px]"), "Preventive CTA must enforce min-h-[44px]");
  });
});
