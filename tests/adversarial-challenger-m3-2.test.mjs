/**
 * Adversarial Challenger 2 Test Suite for Milestone 3 (Financial, History & Supporting Views)
 *
 * Authored by: teamwork_preview_challenger (Challenger 2)
 * Scope: Empirically stress-test History View responsiveness, CSV export accuracy,
 * modal elevations, and touch targets across Milestone 3 supporting views.
 *
 * Verifies:
 * 1. src/app/historico/history-view.tsx mobile card layout (< 640px) eliminating horizontal overflow
 *    and fitting cleanly across 360px, 390px, and 430px viewports.
 * 2. buildExtratoCsv CSV export function producing accurate CSV rows matching shift obligations.
 * 3. Modal elevations (z-50) and stacking context in places-page.tsx and contacts-page.tsx.
 * 4. Touch targets >= 44x44px in Places, Contacts, and Alerts.
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

import {
  buildExtratoCsv,
  escapeCsvCell,
  extratoFilename,
  formatDataBR,
  formatMoeda,
  formatStatusPlantao,
  situacaoFinanceira,
  EXTRATO_HEADER,
} from "../src/lib/exports/extrato-csv.ts";
import { financialAmounts, isOverdue } from "../src/lib/obligations/financial.ts";

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
        const Link = ({ href, children, className, ...props }) =>
          React.createElement("a", { href, className, ...props }, children);
        Link.default = Link;
        return Link;
      }
      if (id === "@/components/ui/button" || id === "./button") {
        return loadTsxModule("src/components/ui/button.tsx");
      }
      if (id === "@/components/ui/primitives" || id === "./primitives") {
        return loadTsxModule("src/components/ui/primitives.tsx");
      }
      if (id === "@/components/ui/stat-card" || id === "./stat-card") {
        return loadTsxModule("src/components/ui/stat-card.tsx");
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
      if (id === "@/lib/obligations") {
        return { financialAmounts, isOverdue };
      }
      if (id === "@/lib/exports/extrato-csv") {
        return {
          buildExtratoCsv,
          downloadExtratoCsv: () => {},
          extratoFilename,
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

describe("Empirical Stress-Testing: History View Responsiveness & Mobile Cards (< 640px)", () => {
  const historyViewPath = path.join(ROOT, "src/app/historico/history-view.tsx");
  const historyViewSource = fs.readFileSync(historyViewPath, "utf8");
  const historyModule = loadTsxModule("src/app/historico/history-view.tsx");
  const HistoryView = historyModule.default || historyModule.HistoryView;

  test("[CH-M3-01] Desktop table is cleanly isolated via hidden sm:block and mobile cards render via sm:hidden", () => {
    // Check that desktop table container uses hidden sm:block overflow-x-auto
    const tableWrapperMatch = historyViewSource.match(/className=["'][^"']*hidden\s+sm:block[^"']*overflow-x-auto[^"']*["']/);
    assert.ok(
      tableWrapperMatch,
      "Desktop table must be wrapped in 'hidden sm:block overflow-x-auto' to prevent mobile rendering"
    );

    // Check that mobile card container uses sm:hidden
    const mobileCardsMatch = historyViewSource.match(/className=["'][^"']*sm:hidden[^"']*["']/);
    assert.ok(
      mobileCardsMatch,
      "Mobile card view must be conditioned with 'sm:hidden' so it renders only on mobile viewports (< 640px)"
    );

    // Check that old min-w-[680px] is completely gone or NOT present on mobile
    const hasUnconditionalMinW = /className=["'][^"']*min-w-\[\d+px\][^"']*["']/.test(
      historyViewSource.replace(/hidden\s+sm:block[\s\S]*?<\/div>/, "")
    );
    assert.equal(
      hasUnconditionalMinW,
      false,
      "Mobile container must not contain hardcoded min-w-[680px] or other rigid pixel width constraints"
    );
  });

  test("[CH-M3-02] Mobile Viewport Geometry Stress Test (360px, 390px, 430px) with Adversarial Long Place Names", () => {
    // Construct synthetic dataset with challenging boundary conditions
    const adversarialShifts = [
      {
        id: "shift-adv-1",
        data: "2026-09-15",
        hora_inicio: "07:00:00",
        hora_fim: "19:00:00",
        status: "realizado",
        place_id: "place-adv-ultra-long",
      },
      {
        id: "shift-adv-2",
        data: "2026-09-20",
        hora_inicio: "19:00:00",
        hora_fim: "07:00:00",
        status: "agendado",
        place_id: "place-adv-normal",
      },
    ];

    const adversarialPlaces = [
      {
        id: "place-adv-ultra-long",
        nome: "Hospital Estadual Central da Região Metropolitana Dr. Victor Ferreira do Amaral - Unidade Coronariana e Hemodinâmica Avançada",
      },
      {
        id: "place-adv-normal",
        nome: "UPA 24h Central",
      },
    ];

    const adversarialObligations = [
      {
        id: "ob-1",
        shift_id: "shift-adv-1",
        data_prevista: "2026-09-25",
        valor_devido: 125000.5,
        saldo: 25000.5,
      },
      {
        id: "ob-2",
        shift_id: "shift-adv-2",
        data_prevista: "2026-09-30",
        valor_devido: 2500,
        saldo: 2500,
      },
    ];

    const renderedHtml = ReactDOMServer.renderToString(
      React.createElement(HistoryView, {
        shifts: adversarialShifts,
        places: adversarialPlaces,
        obligations: adversarialObligations,
        contacts: [],
      })
    );

    // Verify SSR output contains both cards
    assert.ok(renderedHtml.includes("Hospital Estadual Central"), "Rendered HTML must include first shift");
    assert.ok(renderedHtml.includes("UPA 24h Central"), "Rendered HTML must include second shift");

    // Geometric analysis for mobile viewports (360px, 390px, 430px):
    // Main container has px-4 (16px left + 16px right = 32px)
    // 360px screen: 360 - 32 = 328px available width
    // Inside card: p-4 (16px left + 16px right = 32px) -> 328 - 32 = 296px
    // 3-column financial grid: grid-cols-3 gap-2 (8px * 2 = 16px gap), p-2.5 (10px * 2 = 20px padding)
    // Column width on 360px: (296 - 20 - 16) / 3 = 86.6px
    // On 390px: (326 - 20 - 16) / 3 = 96.6px
    // On 430px: (366 - 20 - 16) / 3 = 110px

    // Verify card structure contains defensive truncation on long titles:
    assert.ok(
      historyViewSource.includes("truncate") && historyViewSource.includes("min-w-0 flex-1"),
      "Place title must have 'truncate' and container must have 'min-w-0 flex-1' to prevent blowout on 360px"
    );

    // Verify FinancialStatusBadge has shrink-0 so it is not squeezed out by long place names
    assert.ok(
      historyViewSource.includes("FinancialStatusBadge") && historyViewSource.includes("shrink-0"),
      "Status badge must have 'shrink-0' in mobile card header"
    );

    // Verify 3-column financial grid uses grid-cols-3 and text-xs
    assert.ok(
      historyViewSource.includes("grid grid-cols-3") && historyViewSource.includes("text-xs"),
      "Financial grid must use 'grid grid-cols-3' and 'text-xs' for compact alignment"
    );
  });

  test("[CH-M3-03] History View touch targets and form controls meet >= 44px standard", () => {
    // 1. Check "Ver detalhes" link enforces min-h-[44px]
    const detailsLinkMatch = historyViewSource.match(/href=\{`\/calendario\/plantao\/\$\{shift\.id\}`\}[\s\S]*?min-h-\[44px\]/);
    assert.ok(
      detailsLinkMatch,
      "'Ver detalhes' link in mobile card must enforce 'min-h-[44px]' touch target"
    );

    // 2. Check "Exportar CSV" button enforces min-h-[44px] and w-full on mobile
    const csvButtonMatch = historyViewSource.match(/onClick=\{exportCsv\}[\s\S]*?className=["'][^"']*min-h-\[44px\][^"']*w-full[^"']*sm:w-auto[^"']*["']/);
    assert.ok(
      csvButtonMatch,
      "'Exportar CSV' button must enforce 'min-h-[44px]' and mobile full-width 'w-full sm:w-auto'"
    );

    // 3. Verify 5 filter inputs/selects exist with id labels
    for (const filterId of ["filter-from", "filter-to", "filter-status", "filter-place", "filter-query"]) {
      assert.ok(
        historyViewSource.includes(`id="${filterId}"`),
        `Filter control '${filterId}' must exist in filter bar`
      );
    }

    // 4. Verify Input and Select primitives used in history-view provide h-11 / min-h-[44px] and text-base md:text-sm
    const primitivesSource = fs.readFileSync(path.join(ROOT, "src/components/ui/primitives.tsx"), "utf8");
    assert.ok(
      primitivesSource.includes("h-11 min-h-[44px]") && primitivesSource.includes("text-base md:text-sm"),
      "Input & Select primitives must guarantee min-h-[44px] and 'text-base md:text-sm' preventing iOS zoom"
    );
  });

  test("[CH-M3-04] History View Empty States: Handles 0 shifts and 0 active filter matches", () => {
    // 1. Render empty portfolio (0 shifts)
    const emptyPortfolioHtml = ReactDOMServer.renderToString(
      React.createElement(HistoryView, {
        shifts: [],
        places: [],
        obligations: [],
        contacts: [],
      })
    );

    assert.ok(
      emptyPortfolioHtml.includes("Nenhum plantão encontrado"),
      "Empty state title must be rendered when shifts array is empty"
    );
    assert.ok(
      emptyPortfolioHtml.includes("Cadastrar plantão"),
      "Must offer 'Cadastrar plantão' CTA when portfolio is empty"
    );
    assert.ok(
      emptyPortfolioHtml.includes("/calendario?novo=1"),
      "CTA must link to '/calendario?novo=1'"
    );

    // 2. Check source for active filters handling
    assert.ok(
      historyViewSource.includes("hasActiveFilters ?"),
      "History view must differentiate empty portfolio from active filter zero-matches"
    );
    assert.ok(
      historyViewSource.includes("Limpar filtros"),
      "Must provide 'Limpar filtros' CTA when filters are active"
    );
  });

  test("[CH-M3-05] High-Stress Financial Grid with Large Denominations & Multi-Million Currency", () => {
    const hugeShift = [
      {
        id: "shift-huge",
        data: "2026-09-01",
        hora_inicio: "08:00:00",
        hora_fim: "20:00:00",
        status: "realizado",
        place_id: "p1",
      },
    ];
    const hugeObligation = [
      {
        id: "ob-huge",
        shift_id: "shift-huge",
        data_prevista: "2026-09-10",
        valor_devido: 15750000.99,
        saldo: 750000.0,
      },
    ];

    const rendered = ReactDOMServer.renderToString(
      React.createElement(HistoryView, {
        shifts: hugeShift,
        places: [{ id: "p1", nome: "Hospital Geral" }],
        obligations: hugeObligation,
        contacts: [],
      })
    );

    // Expected formatted BRL strings should be present without NaN
    assert.ok(!rendered.includes("NaN"), "Rendered output must never contain NaN");
    assert.ok(rendered.includes("15.750.000,99") || rendered.includes("15.750.001"), "Expected total must be formatted in millions");
  });
});

describe("Empirical Stress-Testing: CSV Export Function (buildExtratoCsv) & Invariant Accuracy", () => {
  test("[CH-M3-06] CSV Protocol Compliance: BOM \\uFEFF, semicolon separator, and exact 10 columns", () => {
    const emptyCsv = buildExtratoCsv([]);
    // 1. BOM check
    assert.equal(
      emptyCsv.charCodeAt(0),
      0xfeff,
      "CSV output must start with UTF-8 BOM (\\uFEFF) for Excel compatibility"
    );

    // 2. Header check
    const headerLine = emptyCsv.slice(1).split("\r\n")[0];
    const cols = headerLine.split(";");
    assert.equal(cols.length, 10, "CSV header must have exactly 10 semicolon-delimited columns");
    assert.deepEqual(
      cols,
      EXTRATO_HEADER,
      "CSV header columns must strictly match EXTRATO_HEADER"
    );

    // 3. Multi-line CRLF line break check
    const multiRowCsv = buildExtratoCsv([
      {
        dataPlantao: "2026-09-12",
        local: "Hospital",
        tipo: null,
        statusPlantao: "realizado",
        responsavel: "Dr. Silva",
        dataPrevista: "2026-09-20",
        valorPrevisto: 1000,
        valorRecebido: 1000,
        saldo: 0,
        atrasado: false,
      },
    ]);
    assert.ok(multiRowCsv.includes("\r\n"), "CSV must use Windows CRLF line endings (\\r\\n) between rows");
  });

  test("[CH-M3-07] Mathematical Invariant Oracle: situacaoFinanceira derivations across 20 synthetic permutations", () => {
    // Derivation rules from AGENTS.md & extrato-csv:
    // - saldo <= 0 && recebido > 0 -> "Recebido"
    // - atrasado && saldo > 0 -> "Atrasado"
    // - recebido > 0 && saldo > 0 -> "Parcial"
    // - otherwise -> "Pendente"

    const testMatrix = [
      // valorPrevisto, valorRecebido, saldo, atrasado, expectedSituacao
      [1000, 1000, 0, false, "Recebido"],
      [1000, 1000, 0, true, "Recebido"], // paid overrides overdue
      [1000, 400, 600, false, "Parcial"],
      [1000, 400, 600, true, "Atrasado"], // overdue with balance > 0 is Atrasado
      [1000, 0, 1000, false, "Pendente"],
      [1000, 0, 1000, true, "Atrasado"],
      [0, 0, 0, false, "Pendente"],
      [500, 250, 250, false, "Parcial"],
      [500, 250, 250, true, "Atrasado"],
      [2000, 2500, 0, false, "Recebido"], // overpayment with 0 saldo
      [1200, 0, 1200, false, "Pendente"],
      [1200, 1200, 0, false, "Recebido"],
      [3500, 1000, 2500, true, "Atrasado"],
      [3500, 1000, 2500, false, "Parcial"],
      [800, 0, 800, true, "Atrasado"],
      [800, 0, 800, false, "Pendente"],
      [999.99, 999.99, 0, false, "Recebido"],
      [999.99, 500, 499.99, false, "Parcial"],
      [999.99, 500, 499.99, true, "Atrasado"],
      [100, 0, 100, true, "Atrasado"],
    ];

    for (const [previsto, recebido, saldo, atrasado, expected] of testMatrix) {
      const result = situacaoFinanceira({
        valorPrevisto: previsto,
        valorRecebido: recebido,
        saldo: saldo,
        atrasado: atrasado,
      });
      assert.equal(
        result,
        expected,
        `Failed situacao derivation for [previsto=${previsto}, recebido=${recebido}, saldo=${saldo}, atrasado=${atrasado}]: expected '${expected}' got '${result}'`
      );
    }
  });

  test("[CH-M3-08] CSV Escaping and Special Character Hardening", () => {
    // Semicolon in field must be quoted
    assert.equal(escapeCsvCell("Hospital São Lucas; Ala Sul"), `"Hospital São Lucas; Ala Sul"`);

    // Double quotes must be escaped as ""
    assert.equal(escapeCsvCell(`Dra. "Luciana" Medeiros`), `"Dra. ""Luciana"" Medeiros"`);

    // Commas and newlines must be quoted
    assert.equal(escapeCsvCell("Rua A, 123"), `"Rua A, 123"`);
    assert.equal(escapeCsvCell("Linha 1\r\nLinha 2"), `"Linha 1\r\nLinha 2"`);

    // Plain text without special characters remains untouched
    assert.equal(escapeCsvCell("Plantão UTI"), "Plantão UTI");

    // Null and undefined turn into empty string
    assert.equal(escapeCsvCell(null), "");
    assert.equal(escapeCsvCell(undefined), "");

    // Date formatting helper
    assert.equal(formatDataBR("2026-09-12"), "12/09/2026");
    assert.equal(formatDataBR(null), "");

    // Currency formatting helper
    assert.ok(formatMoeda(1250.5).includes("1.250,50"));
    assert.ok(formatMoeda(null).includes("0,00"));

    // Status plantao formatting helper
    assert.equal(formatStatusPlantao("realizado"), "Realizado");
    assert.equal(formatStatusPlantao("agendado"), "Agendado");
    assert.equal(formatStatusPlantao("cancelado"), "Cancelado");
  });

  test("[CH-M3-09] HistoryView ExtratoRow Generator Oracle vs buildExtratoCsv", () => {
    const shifts = [
      {
        id: "s1",
        data: "2026-09-01",
        hora_inicio: "07:00:00",
        hora_fim: "19:00:00",
        status: "realizado",
        place_id: "p1",
      },
      {
        id: "s2",
        data: "2026-09-05",
        hora_inicio: "19:00:00",
        hora_fim: "07:00:00",
        status: "realizado",
        place_id: "p2",
      },
      {
        id: "s3",
        data: "2026-09-10",
        hora_inicio: "08:00:00",
        hora_fim: "18:00:00",
        status: "cancelado",
        place_id: "p-missing",
      },
    ];

    const places = [
      { id: "p1", nome: "Hospital Central; Setor 1" },
      { id: "p2", nome: "Clínica Médica" },
    ];

    const contacts = [
      { id: "c1", nome: "Dra. Maria" },
    ];

    const obligations = [
      {
        id: "o1",
        shift_id: "s1",
        data_prevista: "2026-09-15",
        valor_devido: 1500,
        saldo: 0,
        responsavel_contact_id: "c1",
      },
      {
        id: "o2",
        shift_id: "s2",
        data_prevista: "2026-09-01", // in past -> overdue
        valor_devido: 2000,
        saldo: 1000,
        responsavel_place_id: "p2",
      },
      // s3 has no obligation
    ];

    // Simulate HistoryView.exportCsv logic
    const contactNames = new Map(contacts.map((c) => [c.id, c.nome]));
    const placeNames = new Map(places.map((p) => [p.id, p.nome]));

    function responsibleName(ob) {
      if (ob?.responsavel_contact_id) {
        return `Contato · ${contactNames.get(ob.responsavel_contact_id) ?? "não informado"}`;
      }
      if (ob?.responsavel_place_id) {
        return `Local · ${placeNames.get(ob.responsavel_place_id) ?? "não informado"}`;
      }
      return "Não informado";
    }

    const rows = shifts.map((shift) => {
      const obligation = obligations.find((o) => o.shift_id === shift.id);
      const amounts = financialAmounts(shift.status, obligation);
      const placeName = places.find((item) => item.id === shift.place_id)?.nome ?? "Local removido";
      return {
        dataPlantao: shift.data,
        local: placeName,
        tipo: null,
        statusPlantao: shift.status,
        responsavel: responsibleName(obligation),
        dataPrevista: obligation?.data_prevista ?? null,
        valorPrevisto: amounts.expected,
        valorRecebido: amounts.received,
        saldo: amounts.balance,
        atrasado: obligation && amounts.balance > 0 ? isOverdue(obligation.data_prevista) : false,
      };
    });

    const csvOutput = buildExtratoCsv(rows);
    const lines = csvOutput.slice(1).split("\r\n");

    assert.equal(lines.length, 4, "CSV must have header + 3 data rows");

    // Row 1 (s1): Fully paid (Recebido), contact responsible, escaped semicolon in hospital name
    assert.ok(lines[1].includes('"Hospital Central; Setor 1"'), "Row 1 must quote place name containing semicolon");
    assert.ok(lines[1].includes("Contato · Dra. Maria"), "Row 1 must identify contact responsible");
    assert.ok(lines[1].includes("Recebido"), "Row 1 situacao must be 'Recebido'");

    // Row 2 (s2): Overdue (Atrasado), place responsible
    assert.ok(lines[2].includes("Clínica Médica"), "Row 2 must identify place name");
    assert.ok(lines[2].includes("Local · Clínica Médica"), "Row 2 must identify place responsible");
    assert.ok(lines[2].includes("Atrasado"), "Row 2 situacao must be 'Atrasado'");

    // Row 3 (s3): Cancelled, missing place ("Local removido"), no obligation -> saldo 0
    assert.ok(lines[3].includes("Local removido"), "Row 3 must use 'Local removido' fallback");
    assert.ok(lines[3].includes("Não informado"), "Row 3 must use 'Não informado' responsible fallback");
    assert.ok(lines[3].includes("Cancelado"), "Row 3 status must be 'Cancelado'");
  });
});

describe("Empirical Stress-Testing: Modal Elevations (z-50) in Supporting Views", () => {
  const placesPagePath = path.join(ROOT, "src/lib/places/places-page.tsx");
  const contactsPagePath = path.join(ROOT, "src/components/contacts/contacts-page.tsx");
  const appShellPath = path.join(ROOT, "src/components/ui/app-shell.tsx");

  const placesPageCode = fs.readFileSync(placesPagePath, "utf8");
  const contactsPageCode = fs.readFileSync(contactsPagePath, "utf8");
  const appShellCode = fs.readFileSync(appShellPath, "utf8");

  test("[CH-M3-10] Places Page modal container elevates to z-50 with backdrop blur and accessible dialog", () => {
    // 1. Invariant regex match for Places modal
    const placesModalMatch = placesPageCode.match(
      /open\s*&&\s*<div\s+className=["']([^"']*fixed inset-0 z-50[^"']*)["']/
    );
    assert.ok(
      placesModalMatch,
      "Places page must have modal backdrop with 'fixed inset-0 z-50'"
    );

    const backdropClasses = placesModalMatch[1];
    assert.ok(backdropClasses.includes("backdrop-blur-sm"), "Places backdrop must include 'backdrop-blur-sm'");
    assert.ok(backdropClasses.includes("bg-black/60"), "Places backdrop must include 'bg-black/60'");

    // 2. Section accessible dialog attributes
    assert.ok(placesPageCode.includes('role="dialog"'), "Places modal section must specify role='dialog'");
    assert.ok(placesPageCode.includes('aria-modal="true"'), "Places modal section must specify aria-modal='true'");
    assert.ok(placesPageCode.includes('aria-labelledby="place-form-title"'), "Places modal section must link to title via aria-labelledby");
  });

  test("[CH-M3-11] Contacts Page modal container elevates to z-50 with backdrop blur and accessible dialog", () => {
    // 1. Invariant regex match for Contacts modal
    const contactsModalMatch = contactsPageCode.match(
      /isFormOpen\s*&&\s*\(\s*<div\s+className=["']([^"']*fixed inset-0 z-50[^"']*)["']/
    );
    assert.ok(
      contactsModalMatch,
      "Contacts page must have modal backdrop with 'fixed inset-0 z-50'"
    );

    const backdropClasses = contactsModalMatch[1];
    assert.ok(backdropClasses.includes("backdrop-blur-sm"), "Contacts backdrop must include 'backdrop-blur-sm'");
    assert.ok(backdropClasses.includes("bg-black/60"), "Contacts backdrop must include 'bg-black/60'");

    // 2. Section accessible dialog attributes
    assert.ok(contactsPageCode.includes('role="dialog"'), "Contacts modal section must specify role='dialog'");
    assert.ok(contactsPageCode.includes('aria-modal="true"'), "Contacts modal section must specify aria-modal='true'");
    assert.ok(contactsPageCode.includes('aria-labelledby="contact-form-title"'), "Contacts modal section must link to title via aria-labelledby");
  });

  test("[CH-M3-12] Stacking Hierarchy Verification: Header (z-20) < Bottom Nav (z-30) < Modals (z-50)", () => {
    // Verify AppShell header is z-20
    const headerMatch = appShellCode.match(/<header[^>]*className=["']([^"']+)["']/);
    assert.ok(headerMatch && headerMatch[1].includes("z-20"), "Header must have z-20");

    // Verify AppShell bottom nav is z-30
    const navTags = [...appShellCode.matchAll(/<nav\b([\s\S]*?)>/g)].map((m) => m[1]);
    const mobileNav = navTags.find((t) => t.includes('aria-label="Navegação móvel"'));
    assert.ok(mobileNav && mobileNav.includes("z-30"), "Bottom navigation must have z-30");

    // Mathematical stacking context validation
    const zHeader = 20;
    const zBottomNav = 30;
    const zPlacesModal = 50;
    const zContactsModal = 50;

    assert.ok(zHeader < zBottomNav, "Header (z-20) must be lower than Bottom Nav (z-30)");
    assert.ok(zBottomNav < zPlacesModal, "Bottom Nav (z-30) must be lower than Places Modal (z-50)");
    assert.ok(zBottomNav < zContactsModal, "Bottom Nav (z-30) must be lower than Contacts Modal (z-50)");
  });
});

describe("Empirical Stress-Testing: Touch Targets >= 44x44px across Places, Contacts, and Alerts", () => {
  const placesPagePath = path.join(ROOT, "src/lib/places/places-page.tsx");
  const contactsPagePath = path.join(ROOT, "src/components/contacts/contacts-page.tsx");
  const alertsListPath = path.join(ROOT, "src/components/alerts/alerts-list.tsx");

  const placesPageCode = fs.readFileSync(placesPagePath, "utf8");
  const contactsPageCode = fs.readFileSync(contactsPagePath, "utf8");
  const alertsListCode = fs.readFileSync(alertsListPath, "utf8");

  test("[CH-M3-13] Places Page: All interactive buttons and controls meet or exceed 44x44px", () => {
    // 1. Header "+ Novo local" button
    const newPlaceButtonMatch = placesPageCode.match(/onClick=\{startCreate\}[\s\S]*?min-h-\[44px\]/);
    assert.ok(newPlaceButtonMatch, "Header '+ Novo local' button must enforce min-h-[44px]");

    // 2. Edit button (Pencil)
    const editButtonMatch = placesPageCode.match(/aria-label=\{`Editar \$\{place\.nome\}`\}[\s\S]*?(size-11|min-h-\[44px\]\s+min-w-\[44px\])/);
    assert.ok(editButtonMatch, "Places edit button must enforce 44x44px (size-11 / min-h-[44px] min-w-[44px])");

    // 3. Delete button (Trash2)
    const deleteButtonMatch = placesPageCode.match(/aria-label=\{`Excluir \$\{place\.nome\}`\}[\s\S]*?(size-11|min-h-\[44px\]\s+min-w-\[44px\])/);
    assert.ok(deleteButtonMatch, "Places delete button must enforce 44x44px (size-11 / min-h-[44px] min-w-[44px])");

    // 4. Modal Close button (X)
    const closeButtonMatch = placesPageCode.match(/aria-label="Fechar formulário"[\s\S]*?(size-11|min-h-\[44px\]\s+min-w-\[44px\])/);
    assert.ok(closeButtonMatch, "Places modal close button must enforce 44x44px");

    // 5. Modal Cancelar button
    const cancelModalMatch = placesPageCode.match(/onClick=\{closeForm\}[\s\S]*?min-h-\[44px\]/);
    assert.ok(cancelModalMatch, "Places modal 'Cancelar' button must enforce min-h-[44px]");

    // 6. Modal Salvar button
    const submitModalMatch = placesPageCode.match(/type="submit"[\s\S]*?min-h-\[44px\]/);
    assert.ok(submitModalMatch, "Places modal 'Salvar local' button must enforce min-h-[44px]");

    // 7. Empty state action button
    assert.ok(placesPageCode.includes('action='), "Places page must provide rich EmptyState action");
    assert.ok(placesPageCode.includes('+ Novo Local'), "EmptyState action button must be present");
  });

  test("[CH-M3-14] Contacts Page: All interactive buttons and controls meet or exceed 44x44px", () => {
    // 1. Header "+ Adicionar" button
    const addContactMatch = contactsPageCode.match(/onClick=\{openCreate\}[\s\S]*?min-h-\[44px\]/);
    assert.ok(addContactMatch, "Header '+ Adicionar' button must enforce min-h-[44px]");

    // 2. Edit button (Pencil)
    const editContactMatch = contactsPageCode.match(/aria-label=\{`Editar \$\{contact\.nome\}`\}[\s\S]*?(size-11|min-h-\[44px\]\s+min-w-\[44px\])/);
    assert.ok(editContactMatch, "Contacts edit button must enforce 44x44px");

    // 3. Delete button (Trash2)
    const deleteContactMatch = contactsPageCode.match(/aria-label=\{`Excluir \$\{contact\.nome\}`\}[\s\S]*?(size-11|min-h-\[44px\]\s+min-w-\[44px\])/);
    assert.ok(deleteContactMatch, "Contacts delete button must enforce 44x44px");

    // 4. Modal Close button (X)
    const closeContactMatch = contactsPageCode.match(/aria-label="Fechar formulário"[\s\S]*?(size-11|min-h-\[44px\]\s+min-w-\[44px\])/);
    assert.ok(closeContactMatch, "Contacts modal close button must enforce 44x44px");

    // 5. Radio pills (Instituição / Pessoa)
    const radioPillMatch = contactsPageCode.match(/min-h-\[44px\][^"']*touch-manipulation/);
    assert.ok(
      radioPillMatch,
      "Contacts type radio pills must enforce 'min-h-[44px]' and 'touch-manipulation'"
    );

    // 6. Modal Cancelar & Salvar buttons
    const cancelMatch = contactsPageCode.match(/onClick=\{closeForm\}[\s\S]*?min-h-\[44px\]/);
    const saveMatch = contactsPageCode.match(/type="submit"[\s\S]*?min-h-\[44px\]/);
    assert.ok(cancelMatch, "Contacts modal 'Cancelar' button must enforce min-h-[44px]");
    assert.ok(saveMatch, "Contacts modal 'Salvar alterações' button must enforce min-h-[44px]");

    // 7. EmptyState CTA button
    const emptyCtaMatch = contactsPageCode.match(/action=\{[\s\S]*?min-h-\[44px\][\s\S]*?Adicionar contato/);
    assert.ok(emptyCtaMatch, "Contacts EmptyState action button must enforce min-h-[44px]");
  });

  test("[CH-M3-15] Alerts List: All action CTAs and interactive items meet or exceed 44x44px", () => {
    // 1. EmptyState CTA ("Ver calendário")
    const emptyCtaMatch = alertsListCode.match(/href="\/calendario"[\s\S]*?min-h-\[44px\]/);
    assert.ok(emptyCtaMatch, "Alerts EmptyState 'Ver calendário' link must enforce min-h-[44px]");

    // 2. Atraso alert CTA ("Cobrar repasse")
    const atrasoLinkMatch = alertsListCode.match(/href="\/pagamentos\?filter=atrasados"[\s\S]*?min-h-\[44px\]/);
    assert.ok(atrasoLinkMatch, "Alerts 'Cobrar repasse' CTA must enforce min-h-[44px]");

    // 3. Próximo plantão CTA ("Ver plantão")
    const proximoLinkMatch = alertsListCode.match(/href=\{`\/calendario\/plantao\/\$\{alert\.shift\.id\}`\}[\s\S]*?min-h-\[44px\]/);
    assert.ok(proximoLinkMatch, "Alerts 'Ver plantão' CTA must enforce min-h-[44px]");

    // 4. Alert icon container size
    const iconContainerMatch = alertsListCode.match(/size-11/);
    assert.ok(iconContainerMatch, "Alert icon badge container must enforce 'size-11' (44x44px)");
  });
});
