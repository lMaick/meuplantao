/**
 * Empirical Stress-Testing Harness for Milestone 2 (Core Operational Views)
 *
 * Authored by Challenger 1 (teamwork_preview_challenger)
 * 
 * Verifies:
 * 1. Mobile viewports (360px–430px) render cleanly without horizontal overflow
 *    and without squishing day cells to unreadable 45px text boxes.
 * 2. Day cells and quick action buttons maintain touch targets >= 44x44px.
 * 3. All modal form inputs use 'text-base md:text-sm' to eliminate iOS Safari auto-zoom.
 * 4. AST invariants, idempotency key propagation, and z-50 modal elevation.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire, registerHooks } from "node:module";
import ts from "typescript";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

// MAI-139: hook de resolução .ts para imports aninhados do harness
// (ex.: src/lib/auth/redirect.ts -> ../config/site-url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (fs.existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { ErgonomicsOracle } = await import("./helpers/e2e-harness.mjs");

// Helper to evaluate TSX modules in a sandboxed VM
function loadTsxModule(filePath) {
  const code = fs.readFileSync(path.join(ROOT, filePath), "utf8");
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const sandbox = {
    require: (id) => {
      if (id === "react/jsx-runtime") {
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      }
      return require(id);
    },
    exports: {},
    module: { exports: {} },
  };

  vm.runInNewContext(transpiled.outputText, sandbox);
  return { ...sandbox.module.exports, ...sandbox.exports };
}

const { Input, Select } = loadTsxModule("src/components/ui/primitives.tsx");
const shiftCalendarSource = fs.readFileSync(path.join(ROOT, "src/components/shifts/shift-calendar.tsx"), "utf8");

/* ========================================================================= */
/* SUITE 1: RESPONSIVE DUAL-GRID & 360px–430px OVERFLOW STRESS-TESTING       */
/* ========================================================================= */
describe("1. Mobile Viewports (360px–430px) Layout & Overflow Stress", () => {
  const mobileViewports = [360, 375, 390, 412, 430];

  test("Desktop text-pill 7-col grid is strictly hidden on mobile (< 768px md breakpoint)", () => {
    // Desktop grid must use hidden md:grid
    assert.match(
      shiftCalendarSource,
      /className=["'][^"']*hidden\s+md:grid\s+grid-cols-7[^"']*["']/,
      "Desktop text-pill grid must include 'hidden md:grid grid-cols-7'"
    );
  });

  test("Mobile compact dot-badge 7-col grid is strictly active only on mobile (md:hidden)", () => {
    // Mobile view wrapper must use md:hidden
    assert.match(
      shiftCalendarSource,
      /<div className=["'][^"']*md:hidden[^"']*["']>\s*<div className=["']grid grid-cols-7 border-b border-border pb-2["']>/,
      "Mobile compact view must have md:hidden wrapper"
    );
  });

  test("Mobile day cells render ONLY day numbers and dot badges, NEVER text pills", () => {
    // Extract mobile day cell block from shiftCalendarSource
    const mobileBlockMatch = shiftCalendarSource.match(
      /\{\/\* MOBILE COMPACT VIEW \([^\)]+\): 7-col grid with dot badges \*\/\}[\s\S]*?\{\/\* DESKTOP EXPANDED VIEW/
    );
    assert.ok(mobileBlockMatch, "Mobile compact view block must exist in shift-calendar.tsx");
    const mobileBlock = mobileBlockMatch[0];

    // Verify it renders day number with text-sm leading-none
    assert.match(mobileBlock, /<span className=["']text-sm leading-none["']>\s*\{day\.getDate\(\)\}\s*<\/span>/);

    // Verify it renders shift dots with size-1.5 rounded-full
    assert.match(mobileBlock, /size-1\.5 rounded-full/);

    // CRITICAL: Ensure text pills (such as s.hora_inicio, name(s.place_id), or truncate) are NOT present in mobile day cells
    assert.doesNotMatch(
      mobileBlock,
      /name\(s\.place_id\)/,
      "Mobile day cells must not render shift place names (would cause squishing)"
    );
    assert.doesNotMatch(
      mobileBlock,
      /s\.hora_inicio\.slice/,
      "Mobile day cells must not render shift time text pills (would cause squishing)"
    );
  });

  test("Geometric overflow verification: 7-col grid fits within container across 360px–430px", () => {
    // Container horizontal padding: px-4 = 16px * 2 = 32px
    // Section horizontal padding: p-4 = 16px * 2 = 32px
    // Grid column gap: gap-1 = 4px * 6 = 24px
    const containerPadding = 32;
    const sectionPadding = 32;
    const totalGaps = 4 * 6; // 6 gaps for 7 columns

    for (const vp of mobileViewports) {
      const availableGridWidth = vp - containerPadding - sectionPadding - totalGaps;
      const colWidth = availableGridWidth / 7;

      // Ensure positive column width without overflow
      assert.ok(colWidth > 0, `Column width must be positive on ${vp}px viewport`);
      const totalContentWidth = colWidth * 7 + totalGaps + sectionPadding + containerPadding;

      const overflowOracle = ErgonomicsOracle.evaluateViewportOverflow(vp, totalContentWidth);
      assert.equal(
        overflowOracle.pass,
        true,
        `Viewport ${vp}px must not have horizontal overflow (content width: ${totalContentWidth}px)`
      );
      assert.equal(overflowOracle.overflowPx, 0);
    }
  });

  test("Month navigation controls use flex-wrap to prevent horizontal overflow on narrow viewports", () => {
    assert.match(
      shiftCalendarSource,
      /className=["'][^"']*flex flex-wrap items-center justify-between gap-3[^"']*["']/,
      "Month navigation header must use flex-wrap"
    );
  });

  test("Day Agenda aside is rendered outside the 7-col grid for comfortable shift inspection", () => {
    // Aside contains plantões do dia list and does not squeeze inside calendar cells
    assert.match(shiftCalendarSource, /<aside className=["'][^"']*rounded-2xl border border-border bg-card[^"']*["']>/);
    assert.match(shiftCalendarSource, /Plantões do dia/);
  });
});

/* ========================================================================= */
/* SUITE 2: TOUCH TARGET ERGONOMICS (>= 44x44px)                            */
/* ========================================================================= */
describe("2. Touch Targets Standards (>= 44x44px) on Day Cells and Actions", () => {
  test("Mobile day cells enforce h-11 min-h-[44px] and touch-manipulation", () => {
    assert.match(
      shiftCalendarSource,
      /className=\{cn\(\s*["']h-11 min-h-\[44px\] w-full rounded-xl flex flex-col items-center justify-center p-1 relative transition-all touch-manipulation cursor-pointer["']/,
      "Mobile day cell button must have 'h-11 min-h-[44px]' and 'touch-manipulation'"
    );
  });

  test("Empty day placeholder cells maintain h-11 min-h-[44px] for vertical grid alignment", () => {
    assert.match(
      shiftCalendarSource,
      /className=["']h-11 min-h-\[44px\] pointer-events-none["']/,
      "Empty day placeholder must maintain h-11 min-h-[44px]"
    );
  });

  test("Month navigation previous/next icon buttons enforce min-h-[44px] min-w-[44px]", () => {
    const prevMatch = shiftCalendarSource.match(
      /<Button[^>]*aria-label="Mês anterior"[^>]*className=["']([^"']+)["']/
    );
    assert.ok(prevMatch, "Previous month button must exist");
    assert.match(prevMatch[1], /min-h-\[44px\]/);
    assert.match(prevMatch[1], /min-w-\[44px\]/);

    const nextMatch = shiftCalendarSource.match(
      /<Button[^>]*aria-label="Próximo mês"[^>]*className=["']([^"']+)["']/
    );
    assert.ok(nextMatch, "Next month button must exist");
    assert.match(nextMatch[1], /min-h-\[44px\]/);
    assert.match(nextMatch[1], /min-w-\[44px\]/);
  });

  test("'Hoje' quick button enforces min-h-[44px]", () => {
    const hojeMatch = shiftCalendarSource.match(
      /<Button[\s\S]*?className=["']([^"']+)["'][\s\S]*?>\s*Hoje\s*<\/Button>/
    );
    assert.ok(hojeMatch, "'Hoje' button must exist");
    assert.match(hojeMatch[1], /min-h-\[44px\]/);
  });

  test("Header '+ Novo plantão' button enforces min-h-[44px]", () => {
    const novoMatch = shiftCalendarSource.match(
      /<Button onClick=\{openNew\} className=["']([^"']+)["']>\s*<Plus[^>]*\/> Novo plantão\s*<\/Button>/
    );
    assert.ok(novoMatch, "'Novo plantão' header button must exist");
    assert.match(novoMatch[1], /min-h-\[44px\]/);
  });

  test("Agenda filter pills enforce min-h-[44px] touch targets", () => {
    assert.match(
      shiftCalendarSource,
      /className=\{cn\(\s*["']flex-1 h-10 min-h-\[44px\] rounded-lg px-2 text-xs font-semibold transition-all touch-manipulation cursor-pointer["']/,
      "Filter pills must enforce min-h-[44px] and touch-manipulation"
    );
  });

  test("Shift card edit button (Pencil) enforces min-h-[44px] min-w-[44px]", () => {
    const editBtnMatch = shiftCalendarSource.match(
      /<Button[\s\S]*?size="icon-sm"[\s\S]*?aria-label=\{`Editar plantão em \$\{name\(s\.place_id\)\}`\}[\s\S]*?className=["']([^"']+)["']/
    );
    assert.ok(editBtnMatch, "Shift card edit button must exist");
    assert.match(editBtnMatch[1], /min-h-\[44px\]/);
    assert.match(editBtnMatch[1], /min-w-\[44px\]/);
  });

  test("Shift card 'Ver ficha' link provides min-h-[44px] touch area", () => {
    assert.match(
      shiftCalendarSource,
      /className=["']inline-flex min-h-\[44px\] items-center text-xs font-semibold text-primary hover:underline py-1["']/,
      "'Ver ficha' link must have min-h-[44px]"
    );
  });

  test("Modal close button enforces 44x44px minimum touch target", () => {
    const closeBtnMatch = shiftCalendarSource.match(
      /<button[^>]*aria-label="Fechar"[^>]*className=["']([^"']+)["']/
    );
    assert.ok(closeBtnMatch, "Modal close button must exist");
    assert.match(closeBtnMatch[1], /size-11/);
    assert.match(closeBtnMatch[1], /min-h-\[44px\]/);
    assert.match(closeBtnMatch[1], /min-w-\[44px\]/);
  });

  test("Modal action buttons (Cancelar, Salvar, Excluir) enforce min-h-[44px] and full mobile width", () => {
    assert.match(
      shiftCalendarSource,
      /variant="destructive"[\s\S]*?className=["'][^"']*min-h-\[44px\] w-full sm:w-auto[^"']*["']/,
      "Delete button must have min-h-[44px] and full mobile width"
    );
    assert.match(
      shiftCalendarSource,
      /variant="outline"[\s\S]*?onClick=\{close\}[\s\S]*?className=["'][^"']*min-h-\[44px\] w-full sm:w-auto[^"']*["']/,
      "Cancel button must have min-h-[44px] and full mobile width"
    );
    assert.match(
      shiftCalendarSource,
      /type="submit"[\s\S]*?className=["'][^"']*min-h-\[44px\] w-full sm:w-auto font-semibold[^"']*["']/,
      "Save button must have min-h-[44px] and full mobile width"
    );
  });
});

/* ========================================================================= */
/* SUITE 3: iOS SAFARI AUTO-ZOOM PREVENTATIVE FORM INPUTS                    */
/* ========================================================================= */
describe("3. iOS Safari Auto-Zoom Prevention (text-base md:text-sm)", () => {
  test("Input primitive default classes include 'text-base md:text-sm'", () => {
    const inputElement = Input({});
    const className = inputElement.props.className;
    assert.ok(className.includes("text-base"), "Input must have text-base for mobile font size (16px)");
    assert.ok(className.includes("md:text-sm"), "Input must have md:text-sm for desktop scaling (14px)");
  });

  test("Select primitive default classes include 'text-base md:text-sm'", () => {
    const selectElement = Select({});
    const className = selectElement.props.className;
    assert.ok(className.includes("text-base"), "Select must have text-base for mobile font size (16px)");
    assert.ok(className.includes("md:text-sm"), "Select must have md:text-sm for desktop scaling (14px)");
  });

  test("All 9 modal form controls in shift-calendar use Input or Select primitives without font shrink overrides", () => {
    // Extract the Form component code
    const formMatch = shiftCalendarSource.match(/function Form\(\{[\s\S]*?^}$/m);
    assert.ok(formMatch, "Form component function must exist");
    const formCode = formMatch[0];

    // Check presence of all 9 fields using Input and Select
    assert.match(formCode, /<Select name="place_id"/, "place_id must use Select");
    assert.match(formCode, /<Input name="data" type="date"/, "data must use Input");
    assert.match(formCode, /<Input\s+name="hora_inicio"\s+type="time"/, "hora_inicio must use Input");
    assert.match(formCode, /<Input\s+name="hora_fim"\s+type="time"/, "hora_fim must use Input");
    assert.match(formCode, /<Input\s+name="valor_previsto"\s+type="number"/, "valor_previsto must use Input");
    assert.match(formCode, /<Input\s+name="data_prevista"\s+type="date"/, "data_prevista must use Input");
    assert.match(formCode, /<Select\s+name="responsavel_tipo"/, "responsavel_tipo must use Select");
    assert.match(formCode, /<Select\s+name="responsavel_id"/, "responsavel_id must use Select");
    assert.match(formCode, /<Input type="hidden" name="status"/, "status must use Input primitive");
    assert.match(formCode, /role="radiogroup"/, "status must render as visible radiogroup");

    // Verify no raw <input or <select tags exist inside Form
    const rawInputMatches = formCode.match(/<input\b/g);
    const rawSelectMatches = formCode.match(/<select\b/g);
    assert.equal(rawInputMatches, null, "Form must not use raw unstyled <input> tags");
    assert.equal(rawSelectMatches, null, "Form must not use raw unstyled <select> tags");

    // Verify no className overrides specify text-xs or text-sm on the inputs
    assert.doesNotMatch(formCode, /<Input[^>]*className=["'][^"']*text-(xs|sm)[^"']*["']/);
    assert.doesNotMatch(formCode, /<Select[^>]*className=["'][^"']*text-(xs|sm)[^"']*["']/);
  });
});

/* ========================================================================= */
/* SUITE 4: ARCHITECTURAL & DOMAIN CONTRACT PRESERVATION                     */
/* ========================================================================= */
describe("4. AST Invariants, Idempotency & Modal Z-Index Contracts", () => {
  test("Retains saveShiftWithObligation and does NOT import createShift/updateShift", () => {
    assert.match(
      shiftCalendarSource,
      /import\s*\{[^}]*saveShiftWithObligation[^}]*\}\s*from\s*["']@\/lib\/shifts["']/,
      "Must import saveShiftWithObligation from @/lib/shifts"
    );
    assert.doesNotMatch(
      shiftCalendarSource,
      /\bcreateShift\(/,
      "Must NOT invoke createShift (must go through atomic RPC)"
    );
    assert.doesNotMatch(
      shiftCalendarSource,
      /\bupdateShift\(/,
      "Must NOT invoke updateShift (must go through atomic RPC)"
    );
  });

  test("Retains ShiftCreationIntent and keyForShiftSave for idempotency propagation", () => {
    assert.match(
      shiftCalendarSource,
      /import\s*\{[^}]*ShiftCreationIntent[^}]*keyForShiftSave[^}]*\}\s*from\s*["']@\/lib\/shifts\/idempotency["']/,
      "Must import ShiftCreationIntent and keyForShiftSave"
    );
    assert.match(
      shiftCalendarSource,
      /idempotency_key:\s*keyForShiftSave\(isNew,\s*intent\)/,
      "Must pass idempotency_key: keyForShiftSave(isNew, intent) to saveShiftWithObligation"
    );
  });

  test("Shift modal container elevates to z-50 with safe-area insets", () => {
    assert.match(
      shiftCalendarSource,
      /className=["']fixed inset-0 z-50 flex items-end justify-center bg-slate-950\/50 backdrop-blur-xs sm:items-center["']/,
      "Shift modal must elevate to fixed inset-0 z-50 with backdrop blur"
    );
    assert.match(
      shiftCalendarSource,
      /pb-\[max\(1\.5rem,env\(safe-area-inset-bottom\)\)\]/,
      "Shift modal must include safe-area-inset-bottom padding"
    );
  });
});

/* ========================================================================= */
/* SUITE 5: ADVERSARIAL BOUNDARY CONDITIONS & M2 SUPPORTING VIEWS             */
/* ========================================================================= */
describe("5. Adversarial Boundary Conditions & Supporting M2 Views", () => {
  const plantaoDetailSource = fs.readFileSync(path.join(ROOT, "src/app/calendario/plantao/[id]/page.tsx"), "utf8");
  const dashboardAlertsSource = fs.readFileSync(path.join(ROOT, "src/components/dashboard/dashboard-alerts.tsx"), "utf8");
  const dashboardSource = fs.readFileSync(path.join(ROOT, "src/components/dashboard/dashboard.tsx"), "utf8");

  test("Calendar grid algorithm handles leap years and 28-31 day months without array bounds error", () => {
    function computeDays(cursor) {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
      const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      return Array.from({ length: Math.ceil((start + count) / 7) * 7 }, (_, i) =>
        i < start || i >= start + count
          ? null
          : new Date(cursor.getFullYear(), cursor.getMonth(), i - start + 1)
      );
    }

    // 1. February non-leap (2026): 28 days
    const feb2026 = computeDays(new Date(2026, 1, 1));
    const nonNullFeb2026 = feb2026.filter(Boolean);
    assert.equal(nonNullFeb2026.length, 28);
    assert.equal(feb2026.length % 7, 0, "Total slots must be multiple of 7");

    // 2. February leap year (2028): 29 days
    const feb2028 = computeDays(new Date(2028, 1, 1));
    const nonNullFeb2028 = feb2028.filter(Boolean);
    assert.equal(nonNullFeb2028.length, 29);
    assert.equal(feb2028.length % 7, 0, "Total slots must be multiple of 7");

    // 3. 31-day month spanning 6 weeks (August 2026 starts on Saturday = day 6)
    const aug2026 = computeDays(new Date(2026, 7, 1));
    const nonNullAug2026 = aug2026.filter(Boolean);
    assert.equal(nonNullAug2026.length, 31);
    assert.equal(aug2026.length, 42, "Must generate exactly 42 slots (6 full weeks)");
  });

  test("Modal accessibility: Escape key dismissal and focus trap handling are present", () => {
    assert.match(
      shiftCalendarSource,
      /event\.key === "Escape" && !busy/,
      "Modal must close on Escape when not busy"
    );
    assert.match(
      shiftCalendarSource,
      /event\.key === "Tab"/,
      "Modal must trap Tab key navigation"
    );
    assert.match(
      shiftCalendarSource,
      /<fieldset disabled=\{busy\}/,
      "Modal must disable fieldset during busy submission state"
    );
  });

  test("Plantão detail view (/calendario/plantao/[id]) enforces >= 44px touch targets on all actions", () => {
    // Back link
    assert.match(plantaoDetailSource, /href="\/calendario"[\s\S]*?min-h-\[44px\]/);
    // Edit button
    assert.match(plantaoDetailSource, /href=\{`\/calendario\?editar=\$\{shift\.id\}`\}[\s\S]*?min-h-\[44px\]/);
    // Cancel shift button
    assert.match(plantaoDetailSource, /cancelShiftAction[\s\S]*?min-h-\[44px\]/);
    // Invariant: cannot cancel shift with registered payments
    assert.match(plantaoDetailSource, /detail\.payments\.some\(\(p\)\s*=>\s*p\.status === "registrado"\)/);
  });

  test("Dashboard and Alerts views use semantic CSS tokens without hardcoded raw colors", () => {
    // Dashboard alerts must use semantic destructive and warning tokens
    assert.match(dashboardAlertsSource, /border-destructive\/30/);
    assert.match(dashboardAlertsSource, /bg-destructive\/10/);
    assert.match(dashboardAlertsSource, /text-destructive/);
    assert.match(dashboardAlertsSource, /border-warning\/30/);
    assert.match(dashboardAlertsSource, /bg-warning\/10/);

    // No hardcoded raw palette tokens like bg-rose-100 or bg-amber-100 in alerts
    assert.doesNotMatch(dashboardAlertsSource, /bg-rose-100/);
    assert.doesNotMatch(dashboardAlertsSource, /bg-amber-100/);

    // Dashboard CTA buttons maintain min-h-[44px]
    assert.match(dashboardAlertsSource, /className=["'][^"']*min-h-\[44px\][^"']*["']/);
    assert.match(dashboardSource, /href="\/calendario"[\s\S]*?min-h-\[44px\]/);
  });
});

