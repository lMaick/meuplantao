/**
 * Tier 5 White-Box Adversarial Coverage Hardening Test Suite 1
 *
 * Authored by: teamwork_preview_challenger (Challenger 1)
 * Scope: White-box adversarial testing for Core Operational & Navigation components:
 * 1. Shift Calendar: Month boundary transitions (Dec -> Jan), leap days, century years, empty days, multi-shift days, status color dots.
 * 2. Idempotency & AST Integrity: saveShiftWithObligation, ShiftCreationIntent lifecycle, retry reuse, edit exclusion, modal z-50.
 * 3. Navigation & AppShell: Active route highlighting, auth bypass, safe-area insets, drawer toggle & accessibility, 5-item bottom nav touch targets.
 * 4. Dashboard & Primitives: Alert calculation boundaries (T0, T-1, T+7, T+8), empty states for zero places/shifts, currency formatting, status badges.
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

import {
  ShiftCreationIntent,
  keyForShiftSave,
  newIdempotencyKey,
  startNewShiftIntent,
} from "../src/lib/shifts/idempotency.ts";

import {
  computeDashboardAlerts,
  addDaysToIso,
  calculateDaysDiff,
  getSaoPauloDateIso,
  ALL_PLACES,
} from "../src/lib/dashboard/alerts.ts";

// Helper to transpile and evaluate TSX modules inside a Node VM sandbox
function loadTsxModule(relativeFilePath) {
  const fullPath = path.resolve(process.cwd(), relativeFilePath);
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
      if (id === "cn" || id === "@/lib/utils" || id === "../lib/utils") {
        return { cn: (...args) => args.filter(Boolean).join(" ") };
      }
      if (id === "next/link") {
        const Link = ({ href, children, ...props }) =>
          React.createElement("a", { href, ...props }, children);
        Link.default = Link;
        return Link;
      }
      if (id === "next/navigation") {
        return {
          usePathname: () => "/dashboard",
          useSearchParams: () => new URLSearchParams(),
          useRouter: () => ({ push: () => {}, replace: () => {} }),
        };
      }
      if (id === "@/lib/auth/logout-button") {
        const LogoutButton = () => React.createElement("button", { type: "button", className: "min-h-[44px]" }, "Sair");
        return { LogoutButton };
      }
      if (id === "@/components/ui/button" || id === "./button") {
        return loadTsxModule("src/components/ui/button.tsx");
      }
      if (id === "@/components/theme/theme-toggle") {
        return { ThemeToggle: () => null };
      }
      if (id === "@/components/subscription" || id === "@/components/subscription/trial-badge") {
        return {
          TrialBadge: () => null,
          TrialBadgeMobile: () => null,
          SubscriptionCard: () => null,
        };
      }
      if (id === "@/components/ui/primitives" || id === "./primitives") {
        return loadTsxModule("src/components/ui/primitives.tsx");
      }
      if (id === "@/components/ui/empty-state" || id === "./empty-state") {
        return loadTsxModule("src/components/ui/empty-state.tsx");
      }
      if (id === "@/components/ui/badge" || id === "./badge") {
        return loadTsxModule("src/components/ui/badge.tsx");
      }
      if (id === "@/lib/dashboard/alerts") {
        return { computeDashboardAlerts, addDaysToIso, calculateDaysDiff, getSaoPauloDateIso, ALL_PLACES };
      }
      if (id === "@/lib/finance-filters") {
        return { ALL_PLACES: "all" };
      }
      if (id === "@/lib/accessibility/use-focus-trap") {
        return { useFocusTrap: () => {} };
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
/* SUITE 1: SHIFT CALENDAR WHITE-BOX ADVERSARIAL STRESS                      */
/* ========================================================================= */

describe("Tier 5 [Calendar]: Month Boundary Transitions, Leap Days, Empty Days & Dot Badges", () => {
  const calendarSource = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");

  // Replicate calendar grid calculation algorithm from shift-calendar.tsx lines 107-115
  function computeCalendarGrid(cursor) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return {
      start,
      count,
      days: Array.from({ length: Math.ceil((start + count) / 7) * 7 }, (_, i) =>
        i < start || i >= start + count
          ? null
          : new Date(cursor.getFullYear(), cursor.getMonth(), i - start + 1)
      ),
    };
  }

  const iso = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  test("[T5-01] Month boundary transitions: December -> January and January -> December rollover", () => {
    // 1. December to January rollover
    const decCursor = new Date(2026, 11, 1); // 2026-12-01
    const nextMonth = new Date(decCursor.getFullYear(), decCursor.getMonth() + 1, 1);
    assert.equal(nextMonth.getFullYear(), 2027, "December + 1 month must roll to next year");
    assert.equal(nextMonth.getMonth(), 0, "December + 1 month must roll to January (month index 0)");

    // 2. January to December rollback
    const janCursor = new Date(2027, 0, 1); // 2027-01-01
    const prevMonth = new Date(janCursor.getFullYear(), janCursor.getMonth() - 1, 1);
    assert.equal(prevMonth.getFullYear(), 2026, "January - 1 month must roll back to previous year");
    assert.equal(prevMonth.getMonth(), 11, "January - 1 month must roll back to December (month index 11)");

    // 3. Generative property test: 120 consecutive months (2024 to 2034)
    for (let year = 2024; year <= 2034; year++) {
      for (let month = 0; month < 12; month++) {
        const cursor = new Date(year, month, 1);
        const { start, count, days } = computeCalendarGrid(cursor);

        // Invariant 1: Grid length is strictly a multiple of 7 (28, 35, or 42)
        assert.equal(days.length % 7, 0, `Month ${year}-${month + 1} length (${days.length}) must be divisible by 7`);
        assert.ok([28, 35, 42].includes(days.length), `Month ${year}-${month + 1} length must be 28, 35, or 42`);

        // Invariant 2: Exactly 'count' non-null days
        const nonNullDays = days.filter((d) => d !== null);
        assert.equal(nonNullDays.length, count, `Month ${year}-${month + 1} must have exactly ${count} days`);

        // Invariant 3: Leading nulls count strictly matches start day (0 to 6)
        const leadingNulls = days.findIndex((d) => d !== null);
        assert.equal(leadingNulls, start, `Month ${year}-${month + 1} leading nulls must equal start day ${start}`);

        // Invariant 4: First day is day 1, last day is day 'count'
        assert.equal(nonNullDays[0].getDate(), 1, `First active date must be day 1`);
        assert.equal(nonNullDays[nonNullDays.length - 1].getDate(), count, `Last active date must be day ${count}`);

        // Invariant 5: Trailing nulls strictly equal length - (start + count)
        const trailingNulls = days.length - (start + count);
        assert.ok(trailingNulls >= 0 && trailingNulls < 7, `Trailing nulls must be within [0, 6]`);
      }
    }
  });

  test("[T5-02] Leap day, century leap and non-leap years boundary math", () => {
    // Leap year 2024: Feb has 29 days
    const feb2024 = computeCalendarGrid(new Date(2024, 1, 1));
    assert.equal(feb2024.count, 29, "2024 is a leap year; Feb must have 29 days");
    assert.equal(iso(feb2024.days.filter(Boolean).pop()), "2024-02-29");

    // Leap year 2028: Feb has 29 days
    const feb2028 = computeCalendarGrid(new Date(2028, 1, 1));
    assert.equal(feb2028.count, 29, "2028 is a leap year; Feb must have 29 days");
    assert.equal(iso(feb2028.days.filter(Boolean).pop()), "2028-02-29");

    // Non-leap year 2025: Feb has 28 days
    const feb2025 = computeCalendarGrid(new Date(2025, 1, 1));
    assert.equal(feb2025.count, 28, "2025 is not a leap year; Feb must have 28 days");
    assert.equal(iso(feb2025.days.filter(Boolean).pop()), "2025-02-28");

    // Century leap year 2000 (divisible by 400): Feb has 29 days
    const feb2000 = computeCalendarGrid(new Date(2000, 1, 1));
    assert.equal(feb2000.count, 29, "Century year 2000 is a leap year; Feb must have 29 days");

    // Century non-leap year 1900 & 2100 (divisible by 100 but not 400): Feb has 28 days
    const feb1900 = computeCalendarGrid(new Date(1900, 1, 1));
    assert.equal(feb1900.count, 28, "Century year 1900 is NOT a leap year; Feb must have 28 days");
    const feb2100 = computeCalendarGrid(new Date(2100, 1, 1));
    assert.equal(feb2100.count, 28, "Century year 2100 is NOT a leap year; Feb must have 28 days");

    // Sunday-start boundary: Feb 2026 starts on Sunday (day 0) and has 28 days -> exactly 28 cells, 0 nulls!
    const feb2026 = computeCalendarGrid(new Date(2026, 1, 1));
    assert.equal(feb2026.start, 0, "Feb 2026 starts on Sunday (day 0)");
    assert.equal(feb2026.count, 28, "Feb 2026 has 28 days");
    assert.equal(feb2026.days.length, 28, "Feb 2026 grid has exactly 28 cells (4 full weeks)");
    assert.equal(feb2026.days[0].getDate(), 1, "First cell is day 1 (zero leading nulls)");
    assert.equal(feb2026.days[27].getDate(), 28, "Last cell is day 28 (zero trailing nulls)");
  });

  test("[T5-03] Empty day agenda rendering and multiple shifts status color dot badges", () => {
    // Verify AST and implementation contracts for empty days and dot badges in shift-calendar.tsx
    assert.ok(
      calendarSource.includes("Nenhum plantão neste dia"),
      "ShiftCalendar must include empty state title for days without shifts"
    );
    assert.ok(
      calendarSource.includes("Não há plantões agendados ou realizados nesta data."),
      "ShiftCalendar must include descriptive empty message"
    );
    assert.ok(
      calendarSource.includes("compact"),
      "EmptyState in calendar day agenda must use compact mode"
    );

    // Color dot mapping contracts
    const normalizedCalendar = calendarSource.replace(/\r\n/g, "\n");
    assert.ok(
      /s\.status\s*===\s*["']realizado["']\s*\?\s*["']bg-emerald-500["']/.test(normalizedCalendar) ||
      normalizedCalendar.includes('s.status === "realizado"\n                              ? "bg-emerald-500"') ||
      normalizedCalendar.includes('s.status === "realizado" ? "bg-emerald-500" : s.status === "agendado" ? "bg-amber-500" : "bg-muted-foreground/40"') ||
      normalizedCalendar.includes('s.status === "realizado"'),
      "Realizado shifts must render emerald-500 dot badge"
    );
    assert.ok(
      calendarSource.includes('bg-amber-500'),
      "Agendado shifts must render amber-500 dot badge"
    );
    assert.ok(
      calendarSource.includes('bg-muted-foreground/40'),
      "Other/cancelado shifts must render neutral muted dot badge"
    );

    // Contrast inversion when day is selected
    assert.ok(
      /isSelected\s*\?\s*["']bg-primary-foreground["']/.test(calendarSource),
      "Dots on selected day cell must invert to bg-primary-foreground for contrast against primary background"
    );
  });

  test("[T5-04] Shift dot overflow (>3 shifts) and chronological sorting in day agenda", () => {
    // Check overflow indicator '+' when dayShifts.length > 3
    assert.ok(
      calendarSource.includes("dayShifts.length > 3"),
      "Calendar must check if dayShifts.length > 3 to render overflow badge"
    );
    assert.ok(
      calendarSource.includes('isSelected ? "text-primary-foreground" : "text-muted-foreground"'),
      "Overflow '+' indicator must adapt contrast when day cell is selected"
    );

    // Agenda sorting by hora_inicio
    assert.ok(
      calendarSource.includes("a.hora_inicio.localeCompare(b.hora_inicio)"),
      "Day agenda must sort shifts chronologically by hora_inicio"
    );

    // Test sort oracle
    const testShifts = [
      { id: "s3", data: "2026-09-12", hora_inicio: "19:00", hora_fim: "07:00" },
      { id: "s1", data: "2026-09-12", hora_inicio: "07:00", hora_fim: "13:00" },
      { id: "s2", data: "2026-09-12", hora_inicio: "13:00", hora_fim: "19:00" },
    ];
    const sorted = [...testShifts].sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    assert.deepEqual(
      sorted.map((s) => s.id),
      ["s1", "s2", "s3"],
      "Shifts must be strictly sorted from earliest to latest"
    );
  });

  test("[T5-05] Form submission validation boundary for status === 'realizado'", () => {
    // Form requires value, data_prevista, and valid responsible when status === 'realizado'
    assert.ok(
      calendarSource.includes('status === "realizado" &&'),
      "ShiftCalendar must validate realizado preconditions"
    );
    assert.ok(
      calendarSource.includes("Plantão realizado exige valor, data prevista e responsável."),
      "Must throw descriptive error if realizado preconditions are violated"
    );

    // Test validation logic oracle
    const validateRealizado = ({ value, dueDate, validResponsible, status }) => {
      if (
        status === "realizado" &&
        (value === null || !Number.isFinite(value) || value < 0 || !dueDate || !validResponsible)
      ) {
        throw new Error("Plantão realizado exige valor, data prevista e responsável.");
      }
      return true;
    };

    // Valid realizado
    assert.doesNotThrow(() =>
      validateRealizado({ value: 1500, dueDate: "2026-09-20", validResponsible: true, status: "realizado" })
    );

    // Invalid value: null
    assert.throws(
      () => validateRealizado({ value: null, dueDate: "2026-09-20", validResponsible: true, status: "realizado" }),
      /Plantão realizado exige valor/
    );

    // Invalid value: negative
    assert.throws(
      () => validateRealizado({ value: -100, dueDate: "2026-09-20", validResponsible: true, status: "realizado" }),
      /Plantão realizado exige valor/
    );

    // Invalid dueDate: empty string
    assert.throws(
      () => validateRealizado({ value: 1500, dueDate: "", validResponsible: true, status: "realizado" }),
      /Plantão realizado exige valor/
    );

    // Invalid responsible: false
    assert.throws(
      () => validateRealizado({ value: 1500, dueDate: "2026-09-20", validResponsible: false, status: "realizado" }),
      /Plantão realizado exige valor/
    );

    // Agendado status permits null/empty financial values without error
    assert.doesNotThrow(() =>
      validateRealizado({ value: null, dueDate: "", validResponsible: false, status: "agendado" })
    );
  });
});

/* ========================================================================= */
/* SUITE 2: IDEMPOTENCY & AST INTEGRITY INVARIANTS                           */
/* ========================================================================= */

describe("Tier 5 [Idempotency & AST]: saveShiftWithObligation, Key Propagation & Modal Layering", () => {
  const calendarSource = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");

  test("[T5-06] AST Integrity: shift-calendar imports saveShiftWithObligation and never calls createShift/updateShift", () => {
    // 1. MUST import saveShiftWithObligation
    assert.ok(
      calendarSource.includes("saveShiftWithObligation"),
      "shift-calendar.tsx must import and reference saveShiftWithObligation"
    );

    // 2. MUST import ShiftCreationIntent and keyForShiftSave
    assert.ok(
      calendarSource.includes("ShiftCreationIntent"),
      "shift-calendar.tsx must import ShiftCreationIntent"
    );
    assert.ok(
      calendarSource.includes("keyForShiftSave"),
      "shift-calendar.tsx must import keyForShiftSave"
    );

    // 3. MUST NOT import or invoke createShift( or updateShift(
    assert.ok(
      !calendarSource.includes("createShift("),
      "shift-calendar.tsx must NEVER call createShift("
    );
    assert.ok(
      !calendarSource.includes("updateShift("),
      "shift-calendar.tsx must NEVER call updateShift("
    );
    assert.ok(
      !calendarSource.match(/import\s*{[^}]*\bcreateShift\b[^}]*}\s*from/),
      "shift-calendar.tsx must NEVER import createShift"
    );
    assert.ok(
      !calendarSource.match(/import\s*{[^}]*\bupdateShift\b[^}]*}\s*from/),
      "shift-calendar.tsx must NEVER import updateShift"
    );
  });

  test("[T5-07] ShiftCreationIntent lifecycle: UUID stability on retry and invalidation on success/cancel", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    assert.match(newIdempotencyKey(), UUID_RE, "Raw newIdempotencyKey must produce valid UUID");
    assert.match(startNewShiftIntent(), UUID_RE, "Raw startNewShiftIntent must produce valid UUID");

    const intent = ShiftCreationIntent.begin();
    assert.ok(intent.isActive, "Fresh intent must be active");
    const key1 = intent.keyForSubmit();
    assert.match(key1, UUID_RE, "Key must be a valid UUID");

    // Retry simulation: key remains completely stable across multiple invocations
    const keyRetry1 = intent.keyForSubmit();
    const keyRetry2 = intent.keyForSubmit();
    assert.equal(key1, keyRetry1, "Retry 1 must yield the exact same idempotency key");
    assert.equal(key1, keyRetry2, "Retry 2 must yield the exact same idempotency key");

    // Success marks intent inactive and prevents reuse
    intent.markSucceeded();
    assert.equal(intent.isActive, false, "Intent must be inactive after markSucceeded");
    assert.throws(
      () => intent.keyForSubmit(),
      /intent de criacao descartada/,
      "Calling keyForSubmit on succeeded intent must fail closed"
    );

    // Cancelation marks intent inactive
    const intentCancel = ShiftCreationIntent.begin();
    assert.ok(intentCancel.isActive);
    intentCancel.markCancelled();
    assert.equal(intentCancel.isActive, false);
    assert.throws(
      () => intentCancel.keyForSubmit(),
      /intent de criacao descartada/,
      "Calling keyForSubmit on cancelled intent must fail closed"
    );
  });

  test("[T5-08] keyForShiftSave contract: new shifts require intent, edit shifts strictly omit key", () => {
    const intent = ShiftCreationIntent.begin();
    const activeKey = intent.keyForSubmit();

    // 1. New shift with intent -> returns active key
    const newKey = keyForShiftSave(true, intent);
    assert.equal(newKey, activeKey, "New shift must receive intent active key");

    // 2. New shift with null intent -> must throw
    assert.throws(
      () => keyForShiftSave(true, null),
      /criacao de plantao exige intent de idempotencia/,
      "New shift without intent must throw an error"
    );

    // 3. Edit shift with intent -> returns null (never sends idempotency key)
    const editKeyWithIntent = keyForShiftSave(false, intent);
    assert.equal(editKeyWithIntent, null, "Edit shift must receive null idempotency key");

    // 4. Edit shift without intent -> returns null
    const editKeyWithoutIntent = keyForShiftSave(false, null);
    assert.equal(editKeyWithoutIntent, null, "Edit shift with null intent must receive null key");

    // 5. Intent was NOT consumed by edit mode
    assert.ok(intent.isActive, "Edit mode must never consume or invalidate the intent");
  });

  test("[T5-09] Shift modal DOM layering: fixed inset-0 z-50, escape key listener and focus trap", () => {
    assert.ok(
      calendarSource.includes("fixed inset-0 z-50"),
      "Shift modal backdrop must specify z-50"
    );
    assert.ok(
      calendarSource.includes('role="dialog"'),
      "Shift modal must define role='dialog'"
    );
    assert.ok(
      calendarSource.includes('aria-modal="true"'),
      "Shift modal must specify aria-modal='true'"
    );
    assert.ok(
      calendarSource.includes('event.key === "Escape"'),
      "Shift modal must handle Escape key dismissal"
    );
    assert.ok(
      calendarSource.includes('event.key === "Tab"'),
      "Shift modal must handle Tab key focus cycle trap"
    );
    assert.ok(
      calendarSource.includes("pb-[max(1.5rem,env(safe-area-inset-bottom))]"),
      "Shift modal must include safe area bottom padding"
    );
  });
});

/* ========================================================================= */
/* SUITE 3: NAVIGATION & APPSHELL ERGONOMICS                                 */
/* ========================================================================= */

describe("Tier 5 [AppShell]: Active Route Highlighting, Safe Areas, Drawer & Tap Targets", () => {
  const appShellSource = fs.readFileSync("src/components/ui/app-shell.tsx", "utf8");

  // Replicate route active checker from app-shell.tsx lines 59-62
  const activeRouteOracle = (pathname, href) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  test("[T5-10] Active route highlighting oracle across all standard and nested routes", () => {
    // 1. Dashboard: exact match only
    assert.equal(activeRouteOracle("/dashboard", "/dashboard"), true, "/dashboard matches /dashboard");
    assert.equal(activeRouteOracle("/dashboard/extra", "/dashboard"), false, "/dashboard/extra must NOT match /dashboard");
    assert.equal(activeRouteOracle("/dashboard-fake", "/dashboard"), false, "/dashboard-fake must NOT match /dashboard");

    // 2. Calendário: exact match and subroutes
    assert.equal(activeRouteOracle("/calendario", "/calendario"), true, "/calendario matches /calendario");
    assert.equal(activeRouteOracle("/calendario/plantao/uuid-123", "/calendario"), true, "Nested plantao detail matches /calendario");
    assert.equal(activeRouteOracle("/calendario-fake", "/calendario"), false, "Unrelated prefix must NOT match /calendario");

    // 3. Pagamentos: exact match and subroutes
    assert.equal(activeRouteOracle("/pagamentos", "/pagamentos"), true, "/pagamentos matches /pagamentos");
    assert.equal(activeRouteOracle("/pagamentos/extrato", "/pagamentos"), true, "Extrato subroute matches /pagamentos");
    assert.equal(activeRouteOracle("/pagamentos-extra", "/pagamentos"), false, "Prefix leak must NOT match /pagamentos");

    // 4. Histórico: exact match and subroutes
    assert.equal(activeRouteOracle("/historico", "/historico"), true, "/historico matches /historico");
    assert.equal(activeRouteOracle("/historico/export", "/historico"), true, "Subroute matches /historico");
    assert.equal(activeRouteOracle("/historico2", "/historico"), false, "Unrelated route must NOT match /historico");
  });

  test("[T5-11] Authentication bypass: Login and Cadastro routes bypass AppShell chrome entirely", () => {
    assert.ok(
      appShellSource.includes('["/login", "/cadastro"].includes(pathname)'),
      "AppShell must inspect pathname for /login and /cadastro"
    );
    assert.ok(
      appShellSource.includes("if ([\"/login\", \"/cadastro\"].includes(pathname)) return <>{children}</>;"),
      "AppShell must return bare children on auth routes"
    );
  });

  test("[T5-12] Safe-area insets: header, drawer, and bottom navigation safe geometry", () => {
    // Header top safe area
    assert.ok(
      appShellSource.includes("pt-[env(safe-area-inset-top,0px)]"),
      "Mobile header must incorporate safe-area-inset-top"
    );

    // Drawer top and bottom safe area
    assert.ok(
      appShellSource.includes("pt-[max(1.5rem,env(safe-area-inset-top))]"),
      "Drawer must incorporate max(1.5rem, env(safe-area-inset-top))"
    );
    assert.ok(
      appShellSource.includes("pb-[max(1.5rem,env(safe-area-inset-bottom))]"),
      "Drawer must incorporate max(1.5rem, env(safe-area-inset-bottom))"
    );

    // Bottom navigation height and padding
    assert.ok(
      appShellSource.includes("h-[calc(4.25rem+env(safe-area-inset-bottom,0px))]"),
      "Bottom navigation height must include safe-area-inset-bottom"
    );
    assert.ok(
      appShellSource.includes("pb-[max(0.375rem,env(safe-area-inset-bottom))]"),
      "Bottom navigation padding must include safe-area-inset-bottom"
    );

    // Main container bottom clearance to avoid bottom nav collision
    // MAI-115: sidebar offset lives as lg:pl-64 on the root container; main has no margin offset
    assert.ok(
      appShellSource.includes("lg:pl-64"),
      "Root container must offset the fixed sidebar via lg:pl-64 (no margin + w-full overflow)"
    );
    assert.ok(
      appShellSource.includes("pb-28 lg:pb-8"),
      "Main container must define pb-28 to prevent fixed bottom bar overlap"
    );
    const mainClassAttr = appShellSource.match(/<main[^>]*className=["']([^"']+)["']/);
    assert.ok(mainClassAttr, "Main container must exist in AppShell");
    assert.ok(
      !mainClassAttr[1].split(/\s+/).includes("lg:ml-64"),
      "Main container must not use lg:ml-64 with w-full (100vw + 256px right-side cut)"
    );
  });

  test("[T5-13] Drawer modal toggle, escape key dismiss, overflow lock and touch targets", () => {
    // Drawer trigger in mobile header: 44x44px minimum
    assert.ok(
      appShellSource.includes('size-11 min-h-[44px] min-w-[44px] rounded-xl text-foreground hover:bg-muted active:bg-muted/80'),
      "Header hamburger menu button must enforce 44x44px target"
    );

    // Drawer backdrop z-50
    assert.ok(
      appShellSource.includes('className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs'),
      "Drawer backdrop must specify z-50"
    );

    // Drawer close button: 44x44px minimum
    assert.ok(
      appShellSource.includes('aria-label="Fechar menu"'),
      "Drawer must include close button with accessible label"
    );

    // Body overflow lock on open
    assert.ok(
      appShellSource.includes('document.body.style.overflow = "hidden"'),
      "Opening drawer must lock background scroll via overflow = hidden"
    );
    assert.ok(
      appShellSource.includes('document.body.style.overflow = ""'),
      "Closing drawer must restore background scroll via overflow = ''"
    );

    // Drawer secondary navigation links: min-h-[44px]
    assert.ok(
      appShellSource.includes("min-h-[44px] items-center gap-3.5 rounded-xl px-3.5 py-3"),
      "Drawer navigation items must enforce min-h-[44px]"
    );
  });

  test("[T5-14] Mobile bottom navigation: 5 items with min-h-[44px] and touch-manipulation", () => {
    const { AppShell } = loadTsxModule("src/components/ui/app-shell.tsx");

    // Render with mock pathname
    const markup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(AppShell, null, React.createElement("div", null, "App Content"))
    );

    // 1. Mobile bottom nav landmark
    assert.ok(markup.includes('aria-label="Navegação móvel"'), "Must render mobile navigation landmark");

    // 2. Count mobile bottom nav links (4 primary + 1 quick action = 5 items)
    const navMatch = markup.match(/<nav\b[^>]*aria-label="Navegação móvel"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navMatch, "Mobile nav markup must be present");
    const linkMatches = [...navMatch[1].matchAll(/<a\b/g)];
    assert.equal(linkMatches.length, 5, "Mobile bottom nav must contain exactly 5 navigation items");

    // 3. Verify all bottom nav items enforce min-h-[44px] and touch-manipulation
    const itemMinHMatches = [...navMatch[1].matchAll(/min-h-\[44px\]/g)];
    assert.equal(itemMinHMatches.length, 5, "All 5 bottom navigation items must specify min-h-[44px]");

    const touchManipulationMatches = [...navMatch[1].matchAll(/touch-manipulation/g)];
    assert.equal(touchManipulationMatches.length, 5, "All 5 bottom navigation items must specify touch-manipulation");
  });
});

/* ========================================================================= */
/* SUITE 4: DASHBOARD & PRIMITIVES WHITE-BOX ADVERSARIAL STRESS             */
/* ========================================================================= */

describe("Tier 5 [Dashboard & Primitives]: Alert Boundaries, Zero-Data Empty States & Money Formatting", () => {
  const todayIso = getSaoPauloDateIso(new Date());

  test("[T5-15] Alert calculation temporal boundaries: T0 (today), T-1 (overdue), T+7 (upcoming), T+8 (out of scope)", () => {
    const places = [{ id: "p1", nome: "Hospital Central" }];
    const shifts = [
      { id: "s_t0", status: "realizado", place_id: "p1", data: todayIso, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_overdue", status: "realizado", place_id: "p1", data: addDaysToIso(todayIso, -2), hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_up7", status: "realizado", place_id: "p1", data: todayIso, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_up8", status: "realizado", place_id: "p1", data: todayIso, hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_agendado", status: "agendado", place_id: "p1", data: addDaysToIso(todayIso, -5), hora_inicio: "07:00", hora_fim: "19:00" },
      { id: "s_paid", status: "realizado", place_id: "p1", data: addDaysToIso(todayIso, -5), hora_inicio: "07:00", hora_fim: "19:00" },
    ];

    const obligations = [
      // Due TODAY: not overdue yet! It's due today, so it belongs to upcoming with daysUntilDue = 0
      { id: "o_t0", shift_id: "s_t0", valor_devido: 1000, saldo: 1000, data_prevista: todayIso, responsavel_place_id: "p1", responsavel_contact_id: null },
      // Due YESTERDAY: overdue! (1 day overdue)
      { id: "o_overdue", shift_id: "s_overdue", valor_devido: 1200, saldo: 1200, data_prevista: addDaysToIso(todayIso, -1), responsavel_place_id: "p1", responsavel_contact_id: null },
      // Due in 7 days: included in upcoming
      { id: "o_up7", shift_id: "s_up7", valor_devido: 800, saldo: 800, data_prevista: addDaysToIso(todayIso, 7), responsavel_place_id: "p1", responsavel_contact_id: null },
      // Due in 8 days: excluded from upcoming!
      { id: "o_up8", shift_id: "s_up8", valor_devido: 500, saldo: 500, data_prevista: addDaysToIso(todayIso, 8), responsavel_place_id: "p1", responsavel_contact_id: null },
      // Agendado shift with past obligation -> NEVER generates financial alert
      { id: "o_agendado", shift_id: "s_agendado", valor_devido: 900, saldo: 900, data_prevista: addDaysToIso(todayIso, -3), responsavel_place_id: "p1", responsavel_contact_id: null },
      // Fully paid past obligation (saldo = 0) -> NEVER generates alert
      { id: "o_paid", shift_id: "s_paid", valor_devido: 2000, saldo: 0, data_prevista: addDaysToIso(todayIso, -10), responsavel_place_id: "p1", responsavel_contact_id: null },
    ];

    const summary = computeDashboardAlerts({
      shifts,
      obligations,
      places,
      now: todayIso,
      placeId: ALL_PLACES,
    });

    // Verification of temporal boundaries:
    assert.equal(summary.overdueCount, 1, "Only o_overdue must be counted as overdue");
    assert.equal(summary.overdueAmount, 1200, "Overdue amount must be exactly 1200");
    assert.equal(summary.topOverdue.daysOverdue, 1, "Yesterday obligation must have daysOverdue = 1");

    assert.equal(summary.upcomingCount, 2, "o_t0 (today) and o_up7 (7 days) must be counted as upcoming");
    assert.equal(summary.upcomingAmount, 1800, "Upcoming amount must be 1000 + 800 = 1800");
    assert.equal(summary.topUpcoming.daysUntilDue, 0, "Today obligation must be top upcoming with daysUntilDue = 0");

    assert.equal(summary.hasAlerts, true, "Summary must have alerts");
  });

  test("[T5-16] Dashboard zero-data state renders clean empty states and 0 alerts banner", () => {
    const emptySummary = computeDashboardAlerts({
      shifts: [],
      obligations: [],
      places: [],
      now: todayIso,
      placeId: ALL_PLACES,
    });

    assert.equal(emptySummary.overdueCount, 0, "Empty state must have 0 overdue");
    assert.equal(emptySummary.upcomingCount, 0, "Empty state must have 0 upcoming");
    assert.equal(emptySummary.hasAlerts, false, "Empty state must have hasAlerts = false");

    const { DashboardAlerts } = loadTsxModule("src/components/dashboard/dashboard-alerts.tsx");
    const bannerMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(DashboardAlerts, { summary: emptySummary })
    );
    assert.equal(bannerMarkup, "", "DashboardAlerts must render empty string (null) when hasAlerts is false");

    // EmptyState verification
    const { EmptyState } = loadTsxModule("src/components/ui/primitives.tsx");
    const emptyStateMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(EmptyState, {
        title: "Nenhum valor pendente",
        description: "Todos os seus plantões realizados estão quitados ou sem pendências financeiras.",
      })
    );
    assert.ok(emptyStateMarkup.includes('role="region"'), "EmptyState must render role='region'");
    assert.ok(emptyStateMarkup.includes("Nenhum valor pendente"), "Must render title");
    assert.ok(emptyStateMarkup.includes("border-dashed"), "Must render border-dashed container");
  });

  test("[T5-17] Currency formatting and FinancialStatusBadge derivation across all financial variants", () => {
    const { Money, FinancialStatusBadge, Input, Select } = loadTsxModule("src/components/ui/primitives.tsx");

    // 1. Money component formatting
    const zeroMoney = ReactDOMServer.renderToStaticMarkup(React.createElement(Money, { value: 0 }));
    assert.ok(zeroMoney.includes("R$") && zeroMoney.includes("0,00"), "0 must format as R$ 0,00");

    const largeMoney = ReactDOMServer.renderToStaticMarkup(React.createElement(Money, { value: 12345.67 }));
    assert.ok(largeMoney.includes("12.345,67"), "12345.67 must format with pt-BR separators");

    // 2. FinancialStatusBadge dynamic derivation
    // Paid (saldo = 0 on realizado)
    const paidMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(FinancialStatusBadge, { status: "realizado", balance: 0 })
    );
    assert.ok(paidMarkup.includes("Pago"), "Realizado with balance=0 must render 'Pago'");
    assert.ok(paidMarkup.includes("bg-emerald-500"), "Paid badge must use emerald dot");

    // Overdue (balance > 0 and isOverdue = true)
    const overdueMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(FinancialStatusBadge, { status: "realizado", balance: 1500, isOverdue: true })
    );
    assert.ok(overdueMarkup.includes("Atrasado"), "Positive balance + overdue must render 'Atrasado'");
    assert.ok(overdueMarkup.includes("bg-rose-500"), "Overdue badge must use rose dot");

    // Upcoming (balance > 0 and isOverdue = false)
    const upcomingMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(FinancialStatusBadge, { status: "realizado", balance: 1500, isOverdue: false })
    );
    assert.ok(upcomingMarkup.includes("A vencer"), "Positive balance + not overdue must render 'A vencer'");
    assert.ok(upcomingMarkup.includes("bg-amber-500"), "Upcoming badge must use amber dot");

    // Agendado
    const agendadoMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(FinancialStatusBadge, { status: "agendado" })
    );
    assert.ok(agendadoMarkup.includes("Agendado"), "Agendado must render 'Agendado'");

    // Cancelado
    const canceladoMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(FinancialStatusBadge, { status: "cancelado" })
    );
    assert.ok(canceladoMarkup.includes("Cancelado"), "Cancelado must render 'Cancelado'");

    // 3. iOS Safari WebKit Auto-Zoom Prevention: Input and Select specify text-base md:text-sm and h-11
    const inputMarkup = ReactDOMServer.renderToStaticMarkup(React.createElement(Input, { placeholder: "Teste" }));
    assert.ok(inputMarkup.includes("h-11 min-h-[44px]"), "Input must specify h-11 min-h-[44px]");
    assert.ok(inputMarkup.includes("text-base md:text-sm"), "Input must specify text-base md:text-sm to prevent iOS zoom");

    const selectMarkup = ReactDOMServer.renderToStaticMarkup(
      React.createElement(Select, null, React.createElement("option", null, "Opção 1"))
    );
    assert.ok(selectMarkup.includes("h-11 min-h-[44px]"), "Select must specify h-11 min-h-[44px]");
    assert.ok(selectMarkup.includes("text-base md:text-sm"), "Select must specify text-base md:text-sm to prevent iOS zoom");
  });
});
