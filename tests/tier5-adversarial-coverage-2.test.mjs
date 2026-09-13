/**
 * Tier 5 White-Box Adversarial Coverage Hardening Suite 2 (Milestone 4)
 *
 * Authored by: teamwork_preview_challenger (Challenger 2)
 * Scope: White-box adversarial coverage analysis and test generation for
 * Financial, History, and Supporting views:
 *   - src/components/payments/payments-page.tsx & src/components/finance/finance-filters.tsx
 *   - src/app/historico/history-view.tsx
 *   - src/lib/places/places-page.tsx
 *   - src/components/contacts/contacts-page.tsx
 *   - src/components/alerts/alerts-list.tsx
 *
 * Coverage Categories:
 * 1. Financial: partial payment precision (0.01 cents, large values), balance overflow prevention, payment cancellation soft deletion.
 * 2. History & CSV: special characters (semicolons, quotes, newlines, UTF-8 accents) in CSV export (RFC 4180), date range filtering edge cases (from > to, empty intervals).
 * 3. Mobile Viewports: extreme narrow viewports (320px, 360px), multi-line text wrapping in mobile cards, modal dialog keyboard dismissals (Escape key).
 * 4. Modal Z-Index: verify stacking context hierarchy across all views (z-50 > z-30 > z-20).
 * 5. Touch Targets & iOS Auto-Zoom Standards across Supporting Views.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();

// Domain imports
import {
  buildExtratoCsv,
  escapeCsvCell,
  formatMoeda,
  situacaoFinanceira,
  EXTRATO_HEADER,
} from "../src/lib/exports/extrato-csv.ts";
import { financialAmounts } from "../src/lib/obligations/financial.ts";

// Strict RFC 4180 CSV parser for adversarial round-trip verification
function parseRfc4180Csv(csvString, separator = ";") {
  const text = csvString.startsWith("\uFEFF") ? csvString.slice(1) : csvString;
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === separator) {
        currentRow.push(currentField);
        currentField = "";
      } else if (char === "\r" && nextChar === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++; // skip \n
      } else if (char === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

// =============================================================================
// CATEGORY 1: Financial Precision, Balance Overflow & Soft-Delete Hardening
// =============================================================================
describe("Tier 5 [Adversarial-2]: Financial Precision & Balance Invariants", () => {
  test("[CH2-FIN-01] Partial payment precision with 0.01 cent boundary values", () => {
    // 1. Boundary: obligation with valor_devido = 0.01 paid with 0.01
    const minimalObligation = { valor_devido: 0.01, saldo: 0.00 };
    const minAmounts = financialAmounts("realizado", minimalObligation);
    assert.equal(minAmounts.expected, 0.01);
    assert.equal(minAmounts.balance, 0.00);
    assert.equal(minAmounts.received, 0.01);

    const minSituacao = situacaoFinanceira({
      valorPrevisto: 0.01,
      valorRecebido: 0.01,
      saldo: 0.00,
      atrasado: false,
    });
    assert.equal(minSituacao, "Recebido", "0.01 payment of 0.01 obligation must transition to 'Recebido'");

    // 2. Boundary: payment of 0.01 on a 1000.00 obligation
    const partialCent = { valor_devido: 1000.00, saldo: 999.99 };
    const partialAmounts = financialAmounts("realizado", partialCent);
    assert.equal(partialAmounts.expected, 1000.00);
    assert.equal(partialAmounts.balance, 999.99);
    // Floating point precision check: (1000.00 - 999.99) can be 0.010000000000000009 in raw JS float
    assert.ok(
      Math.abs(partialAmounts.received - 0.01) < 1e-9,
      "Received amount must accurately reflect 0.01 cent difference"
    );

    const partialSituacao = situacaoFinanceira({
      valorPrevisto: 1000.00,
      valorRecebido: 0.01,
      saldo: 999.99,
      atrasado: false,
    });
    assert.equal(partialSituacao, "Parcial", "Partial cent payment must be classified as 'Parcial'");

    // 3. Multi-installment fractional splits (333.33 + 333.33 + 333.34 = 1000.00)
    const installments = [333.33, 333.33, 333.34];
    const totalPaid = installments.reduce((a, b) => a + b, 0);
    assert.equal(Number(totalPaid.toFixed(2)), 1000.00);

    const fullInstallmentSituacao = situacaoFinanceira({
      valorPrevisto: 1000.00,
      valorRecebido: totalPaid,
      saldo: 0.00,
      atrasado: false,
    });
    assert.equal(fullInstallmentSituacao, "Recebido");
  });

  test("[CH2-FIN-02] Extreme high values and large-scale totalizer aggregation", () => {
    // Test large values: R$ 500.000,00, R$ 1.000.000,00, R$ 99.999.999,99
    const highVal1 = financialAmounts("realizado", { valor_devido: 500000.00, saldo: 200000.00 });
    assert.equal(highVal1.expected, 500000.00);
    assert.equal(highVal1.received, 300000.00);
    assert.equal(highVal1.balance, 200000.00);

    const formattedHigh = formatMoeda(1000000.00);
    assert.ok(
      formattedHigh.includes("1.000.000,00"),
      `Million-level value must format cleanly with pt-BR thousand separators: got ${formattedHigh}`
    );

    // Large-scale aggregation stress: 1,000 shifts of R$ 1.456,75 each
    const shiftCount = 1000;
    const unitDue = 1456.75;
    const unitPaid = 456.75;
    const unitBalance = 1000.00;

    const aggregate = Array.from({ length: shiftCount }).reduce(
      (acc) => {
        const amt = financialAmounts("realizado", { valor_devido: unitDue, saldo: unitBalance });
        return {
          expected: acc.expected + amt.expected,
          received: acc.received + amt.received,
          balance: acc.balance + amt.balance,
        };
      },
      { expected: 0, received: 0, balance: 0 }
    );

    assert.equal(Number(aggregate.expected.toFixed(2)), shiftCount * unitDue);
    assert.equal(Number(aggregate.received.toFixed(2)), shiftCount * unitPaid);
    assert.equal(Number(aggregate.balance.toFixed(2)), shiftCount * unitBalance);
  });

  test("[CH2-FIN-03] Balance overflow prevention & validation in payments-page.tsx", () => {
    const paymentsPagePath = path.join(ROOT, "src/components/payments/payments-page.tsx");
    const source = fs.readFileSync(paymentsPagePath, "utf8");

    // Modal submit must check: value <= 0 and value > modalRow.balance
    assert.ok(
      source.includes("if (!Number.isFinite(value) || value <= 0)"),
      "payments-page.tsx modal submit must reject non-finite or non-positive amounts"
    );
    assert.ok(
      source.includes("if (value > modalRow.balance)"),
      "payments-page.tsx modal submit must strictly block values exceeding modalRow.balance"
    );

    // Inline submit must check: value <= 0 or value > inlineRemaining
    assert.ok(
      source.includes("if (!selectedInline || !Number.isFinite(value) || value <= 0 || value > inlineRemaining)"),
      "payments-page.tsx inline submit must strictly block values exceeding inlineRemaining"
    );

    // Modal input must specify min='0.01' and max={modalRow.balance}
    assert.ok(
      source.includes('min="0.01"') && source.includes("max={modalRow.balance}"),
      "payments-page.tsx modal Input must enforce min='0.01' and max bound to modalRow.balance"
    );

    // Display protection: Math.max(0, ...) protects against negative balance or negative received
    assert.ok(
      source.includes("Math.max(0, Number(obligation.saldo ?? 0))"),
      "payments-page.tsx rows must clamp balance to Math.max(0, ...)"
    );
    assert.ok(
      source.includes("Math.max(0, expected - balance)"),
      "payments-page.tsx rows must clamp received to Math.max(0, ...)"
    );
  });

  test("[CH2-FIN-04] Payment cancellation soft deletion and audit trail integrity", () => {
    const paymentsDalPath = path.join(ROOT, "src/lib/payments/index.ts");
    const dalSource = fs.readFileSync(paymentsDalPath, "utf8");

    // cancelPayment must update status to 'cancelado' and NEVER call .delete()
    assert.ok(
      dalSource.includes('.update({status:"cancelado"})') || dalSource.includes(".update({ status: 'cancelado' })"),
      "cancelPayment must perform a soft update setting status to 'cancelado'"
    );
    assert.equal(
      dalSource.includes(".delete("),
      false,
      "Physical .delete() is strictly forbidden in payments DAL to preserve auditability"
    );

    // removePayment must be an alias to cancelPayment
    assert.ok(
      dalSource.includes("export const removePayment = cancelPayment;"),
      "removePayment must alias cancelPayment"
    );

    // payments-page.tsx must filter out cancelled payments from active registered view
    const paymentsPagePath = path.join(ROOT, "src/components/payments/payments-page.tsx");
    const pageSource = fs.readFileSync(paymentsPagePath, "utf8");

    assert.ok(
      pageSource.includes('payments.filter((p) => p.status === "registrado")'),
      "payments-page.tsx must filter payments by status === 'registrado' so cancelled payments are excluded"
    );
  });
});

// =============================================================================
// CATEGORY 2: History & CSV Export White-Box Hardening (RFC 4180)
// =============================================================================
describe("Tier 5 [Adversarial-2]: History & CSV Export RFC 4180 Adversarial Coverage", () => {
  test("[CH2-CSV-01] Special characters escaping in CSV export (semicolons, quotes, newlines, commas)", () => {
    // 1. Semicolons
    const semi = escapeCsvCell("Hospital São Lucas; Ala Sul");
    assert.equal(semi, '"Hospital São Lucas; Ala Sul"');

    // 2. Double quotes
    const quotes = escapeCsvCell('Hospital "Santa Casa" de Misericórdia');
    assert.equal(quotes, '"Hospital ""Santa Casa"" de Misericórdia"');

    // 3. Newlines and Carriage Returns
    const newlines = escapeCsvCell("Hospital Central\nBloco B\r\nLeito 4");
    assert.equal(newlines, '"Hospital Central\nBloco B\r\nLeito 4"');

    // 4. Commas
    const comma = escapeCsvCell("Av. Paralela, 1000, Salvador, BA");
    assert.equal(comma, '"Av. Paralela, 1000, Salvador, BA"');

    // 5. Plain text with no special characters
    const plain = escapeCsvCell("Hospital Geral do Estado");
    assert.equal(plain, "Hospital Geral do Estado");
  });

  test("[CH2-CSV-02] Strict RFC 4180 Round-Trip Parsing with UTF-8 BOM and Adversarial Rows", () => {
    const adversarialExtratoRows = [
      {
        dataPlantao: "2026-09-10",
        local: 'Hospital "Santa Isabel"; Ala de Emergência',
        tipo: null,
        statusPlantao: "realizado",
        responsavel: "Dra. Maria Conceição; Coordenação",
        dataPrevista: "2026-09-25",
        valorPrevisto: 1850.50,
        valorRecebido: 850.50,
        saldo: 1000.00,
        atrasado: false,
      },
      {
        dataPlantao: "2026-09-12",
        local: "UPA 24h Brotas\nUnidade de Trauma",
        tipo: null,
        statusPlantao: "realizado",
        responsavel: 'Dr. João d\'Ávila "Plantões"',
        dataPrevista: "2026-09-01",
        valorPrevisto: 2400.00,
        valorRecebido: 0,
        saldo: 2400.00,
        atrasado: true,
      },
      {
        dataPlantao: "2026-09-15",
        local: "Clínica São Cristóvão & Filhos, Centro",
        tipo: null,
        statusPlantao: "realizado",
        responsavel: "Local · Clínica São Cristóvão",
        dataPrevista: "2026-09-20",
        valorPrevisto: 1200.00,
        valorRecebido: 1200.00,
        saldo: 0.00,
        atrasado: false,
      },
    ];

    const csvOutput = buildExtratoCsv(adversarialExtratoRows, ";");

    // Must start with UTF-8 BOM (\uFEFF)
    assert.equal(csvOutput.charCodeAt(0), 0xfeff, "CSV output must prepend UTF-8 BOM (0xFEFF)");

    // Parse using strict RFC 4180 parser
    const parsedRows = parseRfc4180Csv(csvOutput, ";");

    // Header row + 3 data rows = 4 rows
    assert.equal(parsedRows.length, 4, `Expected exactly 4 CSV rows; parsed ${parsedRows.length}`);

    // Every single row must have exactly 10 columns (EXTRATO_HEADER length)
    for (let i = 0; i < parsedRows.length; i++) {
      assert.equal(
        parsedRows[i].length,
        EXTRATO_HEADER.length,
        `Row ${i} must have exactly ${EXTRATO_HEADER.length} columns; got ${parsedRows[i].length}`
      );
    }

    // Verify Row 1 data preserved uncorrupted despite quotes, semicolons, accents
    const row1 = parsedRows[1];
    assert.equal(row1[0], "10/09/2026"); // Data do Plantão
    assert.equal(row1[1], 'Hospital "Santa Isabel"; Ala de Emergência'); // Local with quotes + semicolon
    assert.equal(row1[3], "Realizado");
    assert.equal(row1[4], "Dra. Maria Conceição; Coordenação");
    assert.equal(row1[9], "Parcial");

    // Verify Row 2 with newline inside field
    const row2 = parsedRows[2];
    assert.equal(row2[0], "12/09/2026");
    assert.equal(row2[1], "UPA 24h Brotas\nUnidade de Trauma");
    assert.equal(row2[4], 'Dr. João d\'Ávila "Plantões"');
    assert.equal(row2[9], "Atrasado");

    // Verify Row 3 fully paid
    const row3 = parsedRows[3];
    assert.equal(row3[0], "15/09/2026");
    assert.equal(row3[1], "Clínica São Cristóvão & Filhos, Centro");
    assert.equal(row3[9], "Recebido");
  });

  test("[CH2-CSV-03] Date range filtering edge cases in history-view.tsx (from > to, empty intervals)", () => {
    const historyViewPath = path.join(ROOT, "src/app/historico/history-view.tsx");
    const source = fs.readFileSync(historyViewPath, "utf8");

    // Verify filter predicate logic in history-view.tsx
    assert.ok(
      source.includes("(!from || shift.data >= from) &&"),
      "history-view.tsx must filter shift.data >= from"
    );
    assert.ok(
      source.includes("(!to || shift.data <= to) &&"),
      "history-view.tsx must filter shift.data <= to"
    );

    // Synthetic test of the filtering logic under adversarial conditions:
    const mockShifts = [
      { id: "s1", data: "2026-09-05", place_id: "p1", status: "realizado" },
      { id: "s2", data: "2026-09-10", place_id: "p1", status: "realizado" },
      { id: "s3", data: "2026-09-15", place_id: "p1", status: "realizado" },
    ];

    const filterFn = (shifts, from, to) =>
      shifts.filter((s) => (!from || s.data >= from) && (!to || s.data <= to));

    // Inverted range: from > to ("2026-09-15" to "2026-09-05")
    const inverted = filterFn(mockShifts, "2026-09-15", "2026-09-05");
    assert.equal(inverted.length, 0, "Inverted date range must yield 0 records without crashing");

    // Empty interval in the past: "2020-01-01" to "2020-01-10"
    const pastEmpty = filterFn(mockShifts, "2020-01-01", "2020-01-10");
    assert.equal(pastEmpty.length, 0, "Empty date interval must yield 0 records");

    // Exact day boundary: from == to == "2026-09-10"
    const exactDay = filterFn(mockShifts, "2026-09-10", "2026-09-10");
    assert.equal(exactDay.length, 1);
    assert.equal(exactDay[0].id, "s2");

    // Verify history-view.tsx handles 0 rows with EmptyState and disables export
    assert.ok(
      source.includes("disabled={rows.length === 0}"),
      "CSV export button in history-view.tsx must be disabled when rows.length === 0"
    );
    assert.ok(
      source.includes("hasActiveFilters ?"),
      "history-view.tsx must differentiate between empty database vs active filters yielding 0 records"
    );
    assert.ok(
      source.includes("clearFilters"),
      "history-view.tsx must provide a clearFilters action when active filters yield 0 records"
    );
  });
});

// =============================================================================
// CATEGORY 3: Mobile Viewports (320px, 360px), Text Wrapping & Escape Handlers
// =============================================================================
describe("Tier 5 [Adversarial-2]: Mobile Viewports & Keyboard Accessibility", () => {
  test("[CH2-MOB-01] Extreme narrow viewports (320px, 360px) layout stability in history-view.tsx", () => {
    const historyViewPath = path.join(ROOT, "src/app/historico/history-view.tsx");
    const source = fs.readFileSync(historyViewPath, "utf8");

    // Check responsive split
    assert.ok(
      source.includes("hidden sm:block overflow-x-auto"),
      "Desktop table must be hidden on mobile viewports (< 640px)"
    );
    assert.ok(
      source.includes("divide-y divide-border sm:hidden"),
      "Mobile cards must render only on mobile (< 640px) with sm:hidden"
    );

    // Check card layout classes that guarantee 320px compatibility
    assert.ok(
      source.includes("grid grid-cols-3 gap-2 rounded-xl border border-border/60 bg-muted/40 p-2.5 text-center text-xs"),
      "3-column financial grid on mobile card must use compact gap-2 and text-xs to fit 320px viewport without overflow"
    );
    assert.ok(
      source.includes("min-w-0 flex-1"),
      "Mobile card header must use min-w-0 flex-1 to prevent flex children blowout on narrow screens"
    );
    assert.ok(
      source.includes("shrink-0"),
      "Status badge must use shrink-0 so it is never crushed on 320px screens"
    );
  });

  test("[CH2-MOB-02] Multi-line text wrapping in mobile cards across all views", () => {
    // 1. History view truncation
    const historySource = fs.readFileSync(path.join(ROOT, "src/app/historico/history-view.tsx"), "utf8");
    assert.ok(
      historySource.includes("truncate") && historySource.includes("<Link"),
      "history-view.tsx card heading must include truncate to handle 100+ character hospital names"
    );

    // 2. Payments page natural text wrapping
    const paymentsSource = fs.readFileSync(path.join(ROOT, "src/components/payments/payments-page.tsx"), "utf8");
    assert.ok(
      paymentsSource.includes("h3 className=\"text-base font-bold tracking-tight text-foreground\""),
      "payments-page.tsx cards must use heading text that wraps cleanly in mobile card grid"
    );

    // 3. Places page truncation
    const placesSource = fs.readFileSync(path.join(ROOT, "src/lib/places/places-page.tsx"), "utf8");
    assert.ok(
      placesSource.includes("truncate text-base font-semibold"),
      "places-page.tsx must truncate place names on mobile"
    );

    // 4. Contacts page truncation
    const contactsSource = fs.readFileSync(path.join(ROOT, "src/components/contacts/contacts-page.tsx"), "utf8");
    assert.ok(
      contactsSource.includes("truncate font-semibold text-foreground"),
      "contacts-page.tsx must truncate contact names on mobile"
    );

    // 5. Alerts list description leading-relaxed
    const alertsSource = fs.readFileSync(path.join(ROOT, "src/components/alerts/alerts-list.tsx"), "utf8");
    assert.ok(
      alertsSource.includes("truncate") && alertsSource.includes("leading-relaxed"),
      "alerts-list.tsx must truncate title and provide leading-relaxed text wrap for descriptions"
    );
  });

  test("[CH2-MOB-03] Modal dialog keyboard dismissals (Escape key) audit", () => {
    // 1. Payments Page modal Escape handler
    const paymentsSource = fs.readFileSync(path.join(ROOT, "src/components/payments/payments-page.tsx"), "utf8");
    const paymentsHasEscape = paymentsSource.includes('e.key === "Escape"');
    assert.ok(
      paymentsHasEscape,
      "payments-page.tsx Quick Action 'Receber' modal must handle Escape key dismissal"
    );

    // 2. Shift Calendar modal Escape handler
    const shiftSource = fs.readFileSync(path.join(ROOT, "src/components/shifts/shift-calendar.tsx"), "utf8");
    const shiftHasEscape = shiftSource.includes('event.key === "Escape"');
    assert.ok(
      shiftHasEscape,
      "shift-calendar.tsx shift modal must handle Escape key dismissal"
    );

    // 3. AppShell drawer Escape handler
    const shellSource = fs.readFileSync(path.join(ROOT, "src/components/ui/app-shell.tsx"), "utf8");
    const shellHasEscape = shellSource.includes('e.key === "Escape"');
    assert.ok(
      shellHasEscape,
      "app-shell.tsx mobile drawer must handle Escape key dismissal"
    );

    // 4. Places & Contacts Dialogs Escape Handling Audit
    const placesSource = fs.readFileSync(path.join(ROOT, "src/lib/places/places-page.tsx"), "utf8");
    const placesHasEscape = placesSource.includes('Escape');

    const contactsSource = fs.readFileSync(path.join(ROOT, "src/components/contacts/contacts-page.tsx"), "utf8");
    const contactsHasEscape = contactsSource.includes('Escape');

    // Both modals hardened with onKeyDown Escape listeners for keyboard accessibility
    assert.ok(
      placesHasEscape,
      "places-page.tsx modal must handle Escape key dismissal"
    );
    assert.ok(
      contactsHasEscape,
      "contacts-page.tsx modal must handle Escape key dismissal"
    );
  });
});

// =============================================================================
// CATEGORY 4: Modal Z-Index Stacking Context Hierarchy
// =============================================================================
describe("Tier 5 [Adversarial-2]: Modal Stacking Context Hierarchy (z-50 > z-30 > z-20)", () => {
  test("[CH2-ZIX-01] Universal Z-Index Stacking Context Hierarchy across all views", () => {
    // Read all relevant files
    const appShellSource = fs.readFileSync(path.join(ROOT, "src/components/ui/app-shell.tsx"), "utf8");
    const paymentsSource = fs.readFileSync(path.join(ROOT, "src/components/payments/payments-page.tsx"), "utf8");
    const shiftsSource = fs.readFileSync(path.join(ROOT, "src/components/shifts/shift-calendar.tsx"), "utf8");
    const placesSource = fs.readFileSync(path.join(ROOT, "src/lib/places/places-page.tsx"), "utf8");
    const contactsSource = fs.readFileSync(path.join(ROOT, "src/components/contacts/contacts-page.tsx"), "utf8");
    const primitivesSource = fs.readFileSync(path.join(ROOT, "src/components/ui/primitives.tsx"), "utf8");

    // 1. Fixed Elements in AppShell
    // Header must be z-20
    assert.ok(
      appShellSource.includes("sticky top-0 z-20"),
      "AppShell top header must have z-20"
    );
    // Bottom Nav must be z-30
    assert.ok(
      appShellSource.includes("fixed inset-x-0 bottom-0 z-30"),
      "AppShell bottom navigation bar must have z-30"
    );
    // Drawer must be z-50
    assert.ok(
      appShellSource.includes("fixed inset-0 z-50") && appShellSource.includes("Drawer"),
      "AppShell mobile slide-out drawer must have z-50 to stack above bottom nav (z-30)"
    );

    // 2. Modals in operational and supporting views must strictly be z-50
    assert.ok(
      paymentsSource.includes("fixed inset-0 z-50"),
      "payments-page.tsx modal must have z-50"
    );
    assert.ok(
      shiftsSource.includes("fixed inset-0 z-50"),
      "shift-calendar.tsx modal must have z-50"
    );
    assert.ok(
      placesSource.includes("fixed inset-0 z-50"),
      "places-page.tsx modal must have z-50"
    );
    assert.ok(
      contactsSource.includes("fixed inset-0 z-50"),
      "contacts-page.tsx modal must have z-50"
    );
    assert.ok(
      primitivesSource.includes("z-50"),
      "primitives.tsx Modal and Toast must have z-50"
    );

    // Invariant: z-50 > z-30 > z-20 is preserved across 100% of all modals and navigation elements
  });
});

// =============================================================================
// CATEGORY 5: Touch Targets (>= 44px) & iOS WebKit Auto-Zoom Prevention
// =============================================================================
describe("Tier 5 [Adversarial-2]: Touch Targets & iOS WebKit Auto-Zoom Standards", () => {
  test("[CH2-TCH-01] Touch target sizes (>= 44x44px) across Financial, History, Places, Contacts, Alerts", () => {
    // 1. Payments Page: filter pills, export button, modal close
    const paymentsSource = fs.readFileSync(path.join(ROOT, "src/components/payments/payments-page.tsx"), "utf8");
    assert.ok(
      paymentsSource.includes("min-h-[44px]"),
      "payments-page.tsx must enforce min-h-[44px] on interactive buttons"
    );
    assert.ok(
      paymentsSource.includes("min-w-[44px]"),
      "payments-page.tsx modal close button must enforce min-w-[44px]"
    );

    // 2. History View: Export CSV and links
    const historySource = fs.readFileSync(path.join(ROOT, "src/app/historico/history-view.tsx"), "utf8");
    assert.ok(
      historySource.includes("min-h-[44px] w-full sm:w-auto shrink-0 font-semibold"),
      "history-view.tsx Export CSV button must enforce min-h-[44px]"
    );
    assert.ok(
      historySource.includes("inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-primary"),
      "history-view.tsx 'Ver detalhes' mobile link must enforce min-h-[44px]"
    );

    // 3. Places Page: Novo local, edit/trash icons, modal close
    const placesSource = fs.readFileSync(path.join(ROOT, "src/lib/places/places-page.tsx"), "utf8");
    assert.ok(
      placesSource.includes("size-11 min-h-[44px] min-w-[44px]"),
      "places-page.tsx icon buttons must enforce 44x44px"
    );

    // 4. Contacts Page: Adicionar, edit/trash icons, radio type pills
    const contactsSource = fs.readFileSync(path.join(ROOT, "src/components/contacts/contacts-page.tsx"), "utf8");
    assert.ok(
      contactsSource.includes("size-11 min-h-[44px] min-w-[44px]"),
      "contacts-page.tsx icon buttons must enforce 44x44px"
    );
    assert.ok(
      contactsSource.includes("min-h-[44px] cursor-pointer"),
      "contacts-page.tsx radio type pills must enforce min-h-[44px]"
    );

    // 5. Alerts List: Cobrar repasse and Ver plantão action links
    const alertsSource = fs.readFileSync(path.join(ROOT, "src/components/alerts/alerts-list.tsx"), "utf8");
    assert.ok(
      alertsSource.includes("inline-flex min-h-[44px]"),
      "alerts-list.tsx action links must enforce min-h-[44px]"
    );
  });

  test("[CH2-TCH-02] iOS WebKit auto-zoom prevention (text-base md:text-sm) on form inputs", () => {
    // Primitives default
    const primitivesSource = fs.readFileSync(path.join(ROOT, "src/components/ui/primitives.tsx"), "utf8");
    assert.ok(
      primitivesSource.includes("text-base md:text-sm"),
      "Input primitive in primitives.tsx must define 'text-base md:text-sm' to prevent iOS auto-zoom"
    );

    // Finance filters
    const financeFiltersSource = fs.readFileSync(path.join(ROOT, "src/components/finance/finance-filters.tsx"), "utf8");
    assert.ok(
      financeFiltersSource.includes("text-base") && financeFiltersSource.includes("md:text-sm"),
      "FinanceFilters must define text-base md:text-sm on month input and select"
    );

    // Payments inline inputs
    const paymentsSource = fs.readFileSync(path.join(ROOT, "src/components/payments/payments-page.tsx"), "utf8");
    assert.ok(
      paymentsSource.includes("text-base md:text-sm"),
      "payments-page.tsx inputs must enforce text-base md:text-sm"
    );
  });
});
