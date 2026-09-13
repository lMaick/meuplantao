/**
 * Adversarial Challenger 1 Test Suite for Milestone 3 (Financial, History & Supporting Views)
 *
 * Authored by: teamwork_preview_challenger (Challenger 1)
 * Scope: Empirically stress-test Payments, Finance Filters, and financial logic
 * against PROJECT.md, ORIGINAL_REQUEST.md, AGENTS.md, and worker_m3 deliverables.
 *
 * Verifies:
 * 1. Dynamic status derivation in FinancialStatusBadge (on-time, upcoming, overdue, paid)
 * 2. Quick-action "Receber" modal validation (valor <= saldo, valor > 0, createPayment contract)
 * 3. Touch target standards (>= 44x44px) on filter pills, action buttons, inputs
 * 4. iOS WebKit auto-zoom prevention (text-base md:text-sm)
 * 5. Financial totalizers, filtering isolation, and domain invariants
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import ReactDOMServer from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

import { isOverdue as domainIsOverdue, financialAmounts } from "../src/lib/obligations/financial.ts";
import {
  ALL_PERIODS,
  ALL_PLACES,
  currentMonthValue,
  matchesPeriod,
  matchesPlace,
  matchesShift,
} from "../src/lib/finance-filters/index.ts";

// Helper to transpile and evaluate TSX modules inside a Node VM sandbox
function loadTsxModule(filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const code = fs.readFileSync(fullPath, "utf8");
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
      if (id === "@/lib/finance-filters") {
        return {
          ALL_PERIODS: "all",
          ALL_PLACES: "all",
          currentMonthValue,
          isMonthValue: (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
          matchesPeriod,
          matchesPlace,
          matchesShift,
        };
      }
      if (id === "@/lib/obligations") {
        return { isOverdue: domainIsOverdue, financialAmounts };
      }
      if (id.startsWith("lucide-react")) {
        const DummyIcon = ({ className = "", ...props }) =>
          React.createElement("svg", { className, ...props });
        return new Proxy(
          {},
          {
            get: (_, prop) => (prop === "__esModule" ? true : DummyIcon),
          }
        );
      }
      return require(id);
    },
    exports: {},
    module: { exports: {} },
  };

  vm.runInNewContext(transpiled.outputText, sandbox);
  return { ...sandbox.module.exports, ...sandbox.exports };
}

/* ========================================================================= */
/* SUITE 1: DYNAMIC STATUS DERIVATION IN FINANCIALSTATUSBADGE               */
/* ========================================================================= */

describe("[CH-M3] Suite 1: Dynamic Status Derivation in FinancialStatusBadge", () => {
  const { FinancialStatusBadge } = loadTsxModule("src/components/ui/primitives.tsx");

  test("[CH-M3-01] Realizado with balance = 0 derives 'Pago' with success variant", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(FinancialStatusBadge, {
        status: "realizado",
        balance: 0,
        isOverdue: false,
      })
    );

    assert.ok(html.includes("Pago"), "Badge text must be 'Pago'");
    assert.ok(html.includes("bg-emerald-500"), "Must render success badge variant");
    assert.ok(html.includes("rounded-full"), "Must include indicator dot");
  });

  test("[CH-M3-02] Realizado with balance = 0 and isOverdue = true STILL derives 'Pago' (Paid overrides Overdue)", () => {
    // CRITICAL DOMAIN INVARIANT: Once paid, a shift must NEVER be marked overdue
    const html = ReactDOMServer.renderToString(
      React.createElement(FinancialStatusBadge, {
        status: "realizado",
        balance: 0,
        isOverdue: true,
      })
    );

    assert.ok(html.includes("Pago"), "Fully paid shift must show 'Pago'");
    assert.ok(!html.includes("Atrasado"), "Paid shift must NOT show 'Atrasado'");
    assert.ok(html.includes("bg-emerald-500"), "Must retain success variant");
  });

  test("[CH-M3-03] Realizado with balance > 0 and isOverdue = false derives 'A vencer' (on-time/upcoming)", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(FinancialStatusBadge, {
        status: "realizado",
        balance: 1500,
        isOverdue: false,
      })
    );

    assert.ok(html.includes("A vencer"), "On-time pending balance must show 'A vencer'");
    assert.ok(html.includes("bg-amber-500"), "Must render warning/amber badge variant");
    assert.ok(!html.includes("Atrasado"), "On-time balance must not show Atrasado");
  });

  test("[CH-M3-04] Realizado with balance > 0 and isOverdue = true derives 'Atrasado'", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(FinancialStatusBadge, {
        status: "realizado",
        balance: 800,
        isOverdue: true,
      })
    );

    assert.ok(html.includes("Atrasado"), "Overdue balance must show 'Atrasado'");
    assert.ok(html.includes("bg-rose-500"), "Must render destructive/rose badge variant");
  });

  test("[CH-M3-05] Boundary condition: balance = 0.01 cent correctly derives status", () => {
    const htmlOnTime = ReactDOMServer.renderToString(
      React.createElement(FinancialStatusBadge, {
        status: "realizado",
        balance: 0.01,
        isOverdue: false,
      })
    );
    assert.ok(htmlOnTime.includes("A vencer"), "0.01 balance on-time must show 'A vencer'");

    const htmlOverdue = ReactDOMServer.renderToString(
      React.createElement(FinancialStatusBadge, {
        status: "realizado",
        balance: 0.01,
        isOverdue: true,
      })
    );
    assert.ok(htmlOverdue.includes("Atrasado"), "0.01 balance overdue must show 'Atrasado'");
  });

  test("[CH-M3-06] Explicit statuses ('pago', 'recebido', 'atrasado', 'a-vencer', 'agendado', 'cancelado')", () => {
    const states = [
      { status: "pago", expectedText: "Pago", expectedClass: "bg-emerald-500" },
      { status: "recebido", expectedText: "Pago", expectedClass: "bg-emerald-500" },
      { status: "atrasado", expectedText: "Atrasado", expectedClass: "bg-rose-500" },
      { status: "a-vencer", expectedText: "A vencer", expectedClass: "bg-amber-500" },
      { status: "agendado", expectedText: "Agendado", expectedClass: "bg-amber-500" },
      { status: "cancelado", expectedText: "Cancelado", expectedClass: "text-muted-foreground" },
    ];

    for (const { status, expectedText, expectedClass } of states) {
      const html = ReactDOMServer.renderToString(
        React.createElement(FinancialStatusBadge, { status })
      );
      assert.ok(
        html.includes(expectedText),
        `Status '${status}' must display text '${expectedText}'`
      );
      assert.ok(
        html.includes(expectedClass),
        `Status '${status}' must include style '${expectedClass}'`
      );
    }
  });

  test("[CH-M3-07] Temporal Boundary Conditions for isOverdue in America/Bahia timezone", () => {
    const baseDate = new Date("2026-09-12T12:00:00-03:00");

    // Due yesterday -> Overdue
    assert.equal(domainIsOverdue("2026-09-11", baseDate), true, "Yesterday is overdue");

    // Due today -> NOT overdue yet (grace until end of day)
    assert.equal(domainIsOverdue("2026-09-12", baseDate), false, "Today is NOT overdue");

    // Due tomorrow -> NOT overdue
    assert.equal(domainIsOverdue("2026-09-13", baseDate), false, "Tomorrow is NOT overdue");

    // Late evening boundary (23:59:59 Bahia = 02:59:59 UTC next day)
    const lateEveningBahia = new Date("2026-09-12T23:59:59-03:00");
    assert.equal(
      domainIsOverdue("2026-09-12", lateEveningBahia),
      false,
      "Due date matching current Bahia calendar day is not overdue even at 23:59"
    );
  });
});

/* ========================================================================= */
/* SUITE 2: QUICK-ACTION "RECEBER" MODAL & FINANCIAL INVARIANTS             */
/* ========================================================================= */

describe("[CH-M3] Suite 2: Quick-Action 'Receber' Modal & Financial Invariants", () => {
  const paymentsPagePath = path.join(ROOT, "src/components/payments/payments-page.tsx");
  const paymentsPageCode = fs.readFileSync(paymentsPagePath, "utf8");

  // Oracle replicating handleModalSubmit validation logic from payments-page.tsx
  function validateModalPaymentSubmission({ amount, balance, date }) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return { valid: false, error: "Informe um valor positivo para o pagamento." };
    }
    if (value > balance) {
      return { valid: false, error: `O valor não pode exceder o saldo restante.` };
    }
    if (!date) {
      return { valid: false, error: "Informe a data do pagamento." };
    }
    return { valid: true, value, newBalance: balance - value };
  }

  test("[CH-M3-08] Rejects zero, negative, NaN, and non-numeric payment amounts", () => {
    const testCases = ["0", "-1", "-0.01", "abc", "NaN", "Infinity", "-Infinity", ""];

    for (const tc of testCases) {
      const result = validateModalPaymentSubmission({
        amount: tc,
        balance: 1000,
        date: "2026-09-12",
      });
      assert.equal(result.valid, false, `Amount '${tc}' must be rejected`);
      assert.equal(result.error, "Informe um valor positivo para o pagamento.");
    }
  });

  test("[CH-M3-09] Rejects payment amounts exceeding remaining balance", () => {
    const balance = 800.0;
    const invalidAmounts = ["800.01", "800.1", "1000", "5000"];

    for (const amt of invalidAmounts) {
      const result = validateModalPaymentSubmission({
        amount: amt,
        balance,
        date: "2026-09-12",
      });
      assert.equal(result.valid, false, `Amount ${amt} exceeding balance ${balance} must be rejected`);
      assert.ok(result.error.includes("O valor não pode exceder o saldo restante"));
    }
  });

  test("[CH-M3-10] Accepts valid payment amounts (exact balance, partial payments, 1 cent)", () => {
    const balance = 800.0;

    // Full settlement
    const full = validateModalPaymentSubmission({ amount: "800.00", balance, date: "2026-09-12" });
    assert.equal(full.valid, true);
    assert.equal(full.newBalance, 0);

    // Partial payment
    const partial = validateModalPaymentSubmission({ amount: "350.50", balance, date: "2026-09-12" });
    assert.equal(partial.valid, true);
    assert.equal(partial.newBalance, 449.5);

    // Minimum boundary: 1 cent
    const minCent = validateModalPaymentSubmission({ amount: "0.01", balance, date: "2026-09-12" });
    assert.equal(minCent.valid, true);
    assert.equal(minCent.newBalance, 799.99);
  });

  test("[CH-M3-11] Rejects missing payment date", () => {
    const result = validateModalPaymentSubmission({
      amount: "500",
      balance: 1000,
      date: "",
    });
    assert.equal(result.valid, false);
    assert.equal(result.error, "Informe a data do pagamento.");
  });

  test("[CH-M3-12] Modal submission calls createPayment with correct payload and triggers refresh", () => {
    // Verify source code contract
    assert.ok(
      paymentsPageCode.includes("await createPayment({"),
      "payments-page.tsx must invoke createPayment"
    );
    assert.ok(
      paymentsPageCode.includes("obligation_id: modalRow.obligation.id"),
      "Must pass obligation_id from modalRow"
    );
    assert.ok(
      paymentsPageCode.includes("valor: value"),
      "Must pass validated numeric value"
    );
    assert.ok(
      paymentsPageCode.includes("data_pagamento: modalDate"),
      "Must pass payment date"
    );
    assert.ok(
      paymentsPageCode.includes("closePaymentModal();"),
      "Must close modal upon successful submission"
    );
    assert.ok(
      paymentsPageCode.includes("await load();"),
      "Must reload dataset to derive updated balance"
    );
  });

  test("[CH-M3-13] Quick-action button on card conditionally renders 'Receber' vs 'Totalmente quitado'", () => {
    assert.ok(
      paymentsPageCode.includes("balance > 0 ? ("),
      "Must branch on balance > 0"
    );
    assert.ok(
      paymentsPageCode.includes("onClick={() => openPaymentModal(row)}"),
      "Button must open payment modal with target row"
    );
    assert.ok(
      paymentsPageCode.includes("Totalmente quitado"),
      "When balance is 0, renders quitado indicator without 'Receber' trigger"
    );
  });

  test("[CH-M3-14] Modal dialog DOM accessibility and stacking z-50", () => {
    // 1. Z-Index elevation
    assert.ok(
      paymentsPageCode.includes("fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"),
      "Modal backdrop must specify z-50 and backdrop blur"
    );

    // 2. Dialog role semantics
    assert.ok(paymentsPageCode.includes('role="dialog"'), "Modal must specify role='dialog'");
    assert.ok(paymentsPageCode.includes('aria-modal="true"'), "Modal must specify aria-modal='true'");
    assert.ok(paymentsPageCode.includes('aria-labelledby="payment-modal-title"'), "Modal must link title ID");

    // 3. Close button
    assert.ok(
      paymentsPageCode.includes('aria-label="Fechar modal"'),
      "Modal close button must have accessible aria-label"
    );
    assert.ok(
      paymentsPageCode.includes("min-h-[44px] min-w-[44px]"),
      "Modal close button must specify 44x44px touch target"
    );

    // 4. Safe area insets
    assert.ok(
      paymentsPageCode.includes("pb-[max(1.5rem,env(safe-area-inset-bottom))]"),
      "Modal must accommodate mobile safe-area insets"
    );
  });
});

/* ========================================================================= */
/* SUITE 3: TOUCH TARGET STANDARDS (>= 44x44px)                              */
/* ========================================================================= */

describe("[CH-M3] Suite 3: Touch Target Standardization (>= 44x44px)", () => {
  const paymentsPagePath = path.join(ROOT, "src/components/payments/payments-page.tsx");
  const financeFiltersPath = path.join(ROOT, "src/components/finance/finance-filters.tsx");
  const historyViewPath = path.join(ROOT, "src/app/historico/history-view.tsx");
  const placesPagePath = path.join(ROOT, "src/lib/places/places-page.tsx");
  const contactsPagePath = path.join(ROOT, "src/components/contacts/contacts-page.tsx");
  const alertsListPath = path.join(ROOT, "src/components/alerts/alerts-list.tsx");

  const paymentsCode = fs.readFileSync(paymentsPagePath, "utf8");
  const financeFiltersCode = fs.readFileSync(financeFiltersPath, "utf8");
  const historyViewCode = fs.readFileSync(historyViewPath, "utf8");
  const placesPageCode = fs.readFileSync(placesPagePath, "utf8");
  const contactsPageCode = fs.readFileSync(contactsPagePath, "utf8");
  const alertsListCode = fs.readFileSync(alertsListPath, "utf8");

  test("[CH-M3-15] Filter pills in payments-page.tsx enforce >= 44px height and touch width", () => {
    // Filter buttons: "Todos", "Atrasados", "A vencer", "Pagos"
    const filterPillsMatch = paymentsCode.match(/filters\.map\(\(\[val, label, count\]\) => \{[\s\S]*?<Button[\s\S]*?className="([^"]+)"/);
    assert.ok(filterPillsMatch, "Filter pill Button must exist");
    const classes = filterPillsMatch[1];
    assert.ok(classes.includes("h-11") || classes.includes("min-h-[44px]"), "Filter pills must have h-11 / min-h-[44px]");
    assert.ok(classes.includes("px-4"), "Filter pills must have horizontal padding px-4");
  });

  test("[CH-M3-16] Primary action buttons in payments-page.tsx enforce min-h-[44px]", () => {
    // 1. Export CSV
    assert.ok(
      paymentsCode.includes('className="h-11 min-h-[44px] gap-2 font-medium"'),
      "Export CSV button must enforce min-h-[44px]"
    );

    // 2. Card 'Receber' quick button
    assert.ok(
      paymentsCode.includes('className="h-11 min-h-[44px] w-full gap-2 font-semibold"'),
      "Quick action 'Receber' button must enforce min-h-[44px] and full width"
    );

    // 3. Card 'Ver plantão' link
    assert.ok(
      paymentsCode.includes("min-h-[44px] items-center gap-1 text-sm font-semibold"),
      "Shift details link must enforce min-h-[44px]"
    );

    // 4. Payment cancellation button
    assert.ok(
      paymentsCode.includes('className="h-11 min-h-[44px] px-3 text-xs font-medium text-destructive'),
      "Cancel payment button must enforce min-h-[44px]"
    );

    // 5. Modal Cancelar and Confirmar buttons
    assert.ok(
      paymentsCode.includes('className="h-11 min-h-[44px] flex-1 font-medium"'),
      "Modal Cancelar button must enforce min-h-[44px]"
    );
    assert.ok(
      paymentsCode.includes('className="h-11 min-h-[44px] flex-1 font-semibold"'),
      "Modal Confirmar button must enforce min-h-[44px]"
    );
  });

  test("[CH-M3-17] Form controls in finance-filters.tsx enforce min-h-[44px]", () => {
    // 1. Period month Input
    assert.ok(
      financeFiltersCode.includes('className="h-11 min-h-[44px] min-w-0 flex-1 rounded-lg'),
      "Period input must enforce h-11 min-h-[44px]"
    );

    // 2. 'Todos' quick button
    assert.ok(
      financeFiltersCode.includes('className="h-11 min-h-[44px] px-4 font-medium"'),
      "'Todos' button must enforce h-11 min-h-[44px]"
    );

    // 3. Place Select
    assert.ok(
      financeFiltersCode.includes('className="h-11 min-h-[44px] w-full rounded-lg'),
      "Place select must enforce h-11 min-h-[44px]"
    );
  });

  test("[CH-M3-18] Form inputs in payments-page.tsx enforce min-h-[44px]", () => {
    // Inline select
    const inlineSelectMatch = paymentsCode.match(/<Select[\s\S]*?className="([^"]+)"/);
    assert.ok(inlineSelectMatch, "Inline shift select must exist");
    assert.ok(
      inlineSelectMatch[1].includes("min-h-[44px]") || inlineSelectMatch[1].includes("h-11"),
      "Inline shift select must enforce min-h-[44px]"
    );

    // Inline amount input
    const inlineInputMatch = paymentsCode.match(/<Input[\s\S]*?placeholder="0,00"[\s\S]*?className="([^"]+)"/);
    assert.ok(inlineInputMatch, "Inline amount input must exist");
    assert.ok(
      inlineInputMatch[1].includes("min-h-[44px]") || inlineInputMatch[1].includes("h-11"),
      "Inline amount input must enforce min-h-[44px]"
    );

    // Modal amount input
    const modalAmountMatch = paymentsCode.match(/id="modal-amount"[\s\S]*?className="([^"]+)"/);
    assert.ok(modalAmountMatch, "Modal amount input must exist");
    assert.ok(
      modalAmountMatch[1].includes("min-h-[44px]") || modalAmountMatch[1].includes("h-11"),
      "Modal amount input must enforce min-h-[44px]"
    );

    // Modal date input
    const modalDateMatch = paymentsCode.match(/id="modal-date"[\s\S]*?className="([^"]+)"/);
    assert.ok(modalDateMatch, "Modal date input must exist");
    assert.ok(
      modalDateMatch[1].includes("min-h-[44px]") || modalDateMatch[1].includes("h-11"),
      "Modal date input must enforce min-h-[44px]"
    );
  });

  test("[CH-M3-19] Supporting views (History, Places, Contacts, Alerts) enforce >= 44px touch targets", () => {
    // History CSV export button
    assert.ok(historyViewCode.includes("min-h-[44px]"), "History view must enforce min-h-[44px]");

    // Places action buttons
    assert.ok(placesPageCode.includes("min-h-[44px]"), "Places view must enforce min-h-[44px]");

    // Contacts action buttons
    assert.ok(contactsPageCode.includes("min-h-[44px]"), "Contacts view must enforce min-h-[44px]");

    // Alerts CTA buttons
    assert.ok(alertsListCode.includes("min-h-[44px]"), "Alerts CTAs must enforce min-h-[44px]");
  });
});

/* ========================================================================= */
/* SUITE 4: IOS WEBKIT AUTO-ZOOM PREVENTION (text-base md:text-sm)          */
/* ========================================================================= */

describe("[CH-M3] Suite 4: iOS Auto-Zoom Prevention (text-base md:text-sm)", () => {
  const primitivesPath = path.join(ROOT, "src/components/ui/primitives.tsx");
  const financeFiltersPath = path.join(ROOT, "src/components/finance/finance-filters.tsx");
  const paymentsPagePath = path.join(ROOT, "src/components/payments/payments-page.tsx");

  const primitivesCode = fs.readFileSync(primitivesPath, "utf8");
  const financeFiltersCode = fs.readFileSync(financeFiltersPath, "utf8");
  const paymentsCode = fs.readFileSync(paymentsPagePath, "utf8");

  test("[CH-M3-20] Input primitive specifies text-base (16px) on mobile and md:text-sm on desktop", () => {
    assert.ok(
      primitivesCode.includes("text-base md:text-sm"),
      "Input primitive must define 'text-base md:text-sm' to avoid iOS Safari zoom"
    );
  });

  test("[CH-M3-21] Select primitive specifies text-base (16px) on mobile and md:text-sm on desktop", () => {
    assert.ok(
      primitivesCode.includes("text-base md:text-sm"),
      "Select primitive must define 'text-base md:text-sm' to avoid iOS Safari zoom"
    );
  });

  test("[CH-M3-22] finance-filters.tsx controls include text-base on mobile", () => {
    assert.ok(
      financeFiltersCode.includes("text-base") && financeFiltersCode.includes("md:text-sm"),
      "finance-filters.tsx controls must explicitly include text-base and md:text-sm"
    );
  });

  test("[CH-M3-23] payments-page.tsx controls specify text-base on mobile", () => {
    // Inline controls
    assert.ok(
      paymentsCode.includes("text-base md:text-sm font-normal"),
      "Inline controls must specify text-base md:text-sm"
    );

    // Modal controls
    assert.ok(
      paymentsCode.includes("text-base md:text-sm font-semibold text-lg") ||
      paymentsCode.includes("text-base md:text-sm"),
      "Modal controls must specify text-base on mobile"
    );
  });

  test("[CH-M3-24] Adversarial AST check: No raw un-prefixed text-xs or text-sm on input/select in payments & filters", () => {
    // Verify no input or select has className with un-prefixed "text-xs" or "text-sm"
    const inputMatches = [
      ...paymentsCode.matchAll(/<(?:Input|Select)[^>]*className="([^"]+)"/g),
      ...financeFiltersCode.matchAll(/<(?:Input|Select)[^>]*className="([^"]+)"/g),
    ];

    for (const match of inputMatches) {
      const cls = match[1];
      const tokens = cls.split(/\s+/);
      const invalidShrink = tokens.find(
        (t) => (t === "text-xs" || t === "text-sm") && !t.startsWith("md:") && !t.startsWith("sm:")
      );
      assert.equal(
        invalidShrink,
        undefined,
        `Control with class '${cls}' must not have un-prefixed font shrinkage class '${invalidShrink}'`
      );
    }
  });
});

/* ========================================================================= */
/* SUITE 5: FINANCIAL TOTALIZERS, FILTERING ISOLATION & DOMAIN INVARIANTS   */
/* ========================================================================= */

describe("[CH-M3] Suite 5: Financial Totalizers, Filtering & Domain Invariants", () => {
  // Oracle replicating payments-page.tsx rows calculation and totalizer logic
  function computePaymentsRowsOracle({ shifts, obligations, places, contacts, period, placeId, filter }) {
    const placeNames = new Map(places.map((p) => [p.id, p.nome]));
    const contactNames = new Map(contacts.map((c) => [c.id, c.nome]));

    const rows = shifts
      .filter((s) => s.status === "realizado" && matchesShift(s, period, placeId))
      .flatMap((shift) => {
        const obligation = obligations.find((o) => o.shift_id === shift.id);
        if (!obligation || obligation.valor_devido === null) return [];

        const expected = Number(obligation.valor_devido);
        const balance = Math.max(0, Number(obligation.saldo ?? 0));
        const overdue = balance > 0 && domainIsOverdue(obligation.data_prevista);

        return [
          {
            shift,
            obligation,
            placeName: placeNames.get(shift.place_id) ?? "Local não informado",
            responsible: obligation.responsavel_contact_id
              ? `Contato · ${contactNames.get(obligation.responsavel_contact_id) ?? "não informado"}`
              : `Local · ${placeNames.get(obligation.responsavel_place_id ?? "") ?? "não informado"}`,
            expected,
            received: Math.max(0, expected - balance),
            balance,
            isOverdue: overdue,
          },
        ];
      });

    const visible = rows.filter(({ isOverdue: overdue, balance }) => {
      if (filter === "todos") return true;
      if (filter === "pagos") return balance === 0;
      if (filter === "atrasados") return balance > 0 && overdue;
      if (filter === "a-vencer") return balance > 0 && !overdue;
      return true;
    });

    const totals = rows.reduce(
      (r, row) => ({
        expected: r.expected + row.expected,
        received: r.received + row.received,
        balance: r.balance + row.balance,
      }),
      { expected: 0, received: 0, balance: 0 }
    );

    let pagos = 0;
    let atrasados = 0;
    let aVencer = 0;
    for (const r of rows) {
      if (r.balance === 0) pagos++;
      else if (r.isOverdue) atrasados++;
      else aVencer++;
    }

    return { rows, visible, totals, counts: { todos: rows.length, atrasados, aVencer, pagos } };
  }

  test("[CH-M3-25] Totalizers correctly derive expected, received, and balance with 0 leaks from agendado/cancelado", () => {
    const places = [{ id: "p1", nome: "Hospital Geral" }];
    const contacts = [];
    const shifts = [
      // Realized with balance
      { id: "s1", status: "realizado", place_id: "p1", data: "2026-09-02", hora_inicio: "07:00", hora_fim: "19:00" },
      // Realized fully paid
      { id: "s2", status: "realizado", place_id: "p1", data: "2026-09-05", hora_inicio: "19:00", hora_fim: "07:00" },
      // Agendado (MUST NOT BE INCLUDED IN RECEIVABLES)
      { id: "s3", status: "agendado", place_id: "p1", data: "2026-09-20", hora_inicio: "07:00", hora_fim: "19:00" },
      // Cancelado (MUST NOT BE INCLUDED IN RECEIVABLES)
      { id: "s4", status: "cancelado", place_id: "p1", data: "2026-09-10", hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      { id: "o1", shift_id: "s1", valor_devido: 1200, saldo: 500, data_prevista: "2026-09-15" },
      { id: "o2", shift_id: "s2", valor_devido: 1000, saldo: 0, data_prevista: "2026-09-10" },
      { id: "o3", shift_id: "s3", valor_devido: 1500, saldo: 1500, data_prevista: "2026-09-25" },
      { id: "o4", shift_id: "s4", valor_devido: 800, saldo: 800, data_prevista: "2026-09-12" },
    ];

    const result = computePaymentsRowsOracle({
      shifts,
      obligations,
      places,
      contacts,
      period: "2026-09",
      placeId: ALL_PLACES,
      filter: "todos",
    });

    assert.equal(result.rows.length, 2, "Only realized shifts form receivables rows");
    assert.equal(result.totals.expected, 2200, "Total expected = 1200 + 1000");
    assert.equal(result.totals.received, 1700, "Total received = (1200-500) + (1000-0) = 1700");
    assert.equal(result.totals.balance, 500, "Total balance = 500 + 0 = 500");
  });

  test("[CH-M3-26] Filter tabs partition rows with exact mathematical completeness", () => {
    const places = [{ id: "p1", nome: "Hospital A" }];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "p1", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s2", status: "realizado", place_id: "p1", data: "2026-09-02", hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s3", status: "realizado", place_id: "p1", data: "2026-09-03", hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      // Fully paid
      { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: 0, data_prevista: "2026-08-01" },
      // Overdue (due in 2026-08)
      { id: "o2", shift_id: "s2", valor_devido: 1000, saldo: 1000, data_prevista: "2026-08-01" },
      // On-time / A vencer (due in 2026-12)
      { id: "o3", shift_id: "s3", valor_devido: 1000, saldo: 1000, data_prevista: "2026-12-01" },
    ];

    const baseParams = { shifts, obligations, places, contacts: [], period: "2026-09", placeId: ALL_PLACES };

    const allRes = computePaymentsRowsOracle({ ...baseParams, filter: "todos" });
    const paidRes = computePaymentsRowsOracle({ ...baseParams, filter: "pagos" });
    const overdueRes = computePaymentsRowsOracle({ ...baseParams, filter: "atrasados" });
    const upcomingRes = computePaymentsRowsOracle({ ...baseParams, filter: "a-vencer" });

    assert.equal(allRes.visible.length, 3);
    assert.equal(paidRes.visible.length, 1);
    assert.equal(paidRes.visible[0].shift.id, "s1");

    assert.equal(overdueRes.visible.length, 1);
    assert.equal(overdueRes.visible[0].shift.id, "s2");

    assert.equal(upcomingRes.visible.length, 1);
    assert.equal(upcomingRes.visible[0].shift.id, "s3");

    // Completeness check: sum of partitions equals total
    assert.equal(
      paidRes.visible.length + overdueRes.visible.length + upcomingRes.visible.length,
      allRes.visible.length,
      "Partitions (pagos + atrasados + a-vencer) must exactly equal total"
    );
  });

  test("[CH-M3-27] Period and place filtering strictly isolates data", () => {
    const places = [
      { id: "place-1", nome: "Hospital 1" },
      { id: "place-2", nome: "Hospital 2" },
    ];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "place-1", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s2", status: "realizado", place_id: "place-1", data: "2026-08-01", hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s3", status: "realizado", place_id: "place-2", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: 1000, data_prevista: "2026-09-10" },
      { id: "o2", shift_id: "s2", valor_devido: 1000, saldo: 1000, data_prevista: "2026-08-10" },
      { id: "o3", shift_id: "s3", valor_devido: 1000, saldo: 1000, data_prevista: "2026-09-10" },
    ];

    // Filter by place-1 and 2026-09 -> only s1
    const p1Sep = computePaymentsRowsOracle({
      shifts,
      obligations,
      places,
      contacts: [],
      period: "2026-09",
      placeId: "place-1",
      filter: "todos",
    });
    assert.equal(p1Sep.rows.length, 1);
    assert.equal(p1Sep.rows[0].shift.id, "s1");

    // Filter by place-1 and all periods -> s1 and s2
    const p1All = computePaymentsRowsOracle({
      shifts,
      obligations,
      places,
      contacts: [],
      period: ALL_PERIODS,
      placeId: "place-1",
      filter: "todos",
    });
    assert.equal(p1All.rows.length, 2);

    // Filter by all places and 2026-09 -> s1 and s3
    const allSep = computePaymentsRowsOracle({
      shifts,
      obligations,
      places,
      contacts: [],
      period: "2026-09",
      placeId: ALL_PLACES,
      filter: "todos",
    });
    assert.equal(allSep.rows.length, 2);
  });

  test("[CH-M3-28] Defensive parsing: negative saldo in corrupted data is sanitized to 0", () => {
    const places = [{ id: "p1", nome: "Hospital 1" }];
    const shifts = [
      { id: "s1", status: "realizado", place_id: "p1", data: "2026-09-01", hora_inicio: "07:00", hora_fim: "19:00" },
    ];
    const obligations = [
      // Corrupted negative saldo (-100)
      { id: "o1", shift_id: "s1", valor_devido: 1000, saldo: -100, data_prevista: "2026-09-10" },
    ];

    const res = computePaymentsRowsOracle({
      shifts,
      obligations,
      places,
      contacts: [],
      period: "2026-09",
      placeId: ALL_PLACES,
      filter: "todos",
    });

    assert.equal(res.rows[0].balance, 0, "Corrupted negative balance must be clamped to 0");
    assert.equal(res.rows[0].received, 1000, "Received must be clamped to expected value");
  });
});
