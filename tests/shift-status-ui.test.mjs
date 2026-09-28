import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const calendarPath = path.join(ROOT, "src/components/shifts/shift-calendar.tsx");
const calendarSource = fs.readFileSync(calendarPath, "utf8");

/* ========================================================================= */
/* SUITE 1: STATIC AST & SOURCE CODE CONTRACTS                               */
/* ========================================================================= */
describe("Shift Calendar Modal: Status UI & Accessibility Contracts", () => {
  test("R1: status dropdown is removed in favor of a hidden Input and visible radiogroup", () => {
    // 1. Dropdown select must be gone
    assert.doesNotMatch(
      calendarSource,
      /<Select[^>]*name="status"/,
      "Status must NOT use a dropdown Select component"
    );
    // 2. Hidden input for FormData serialization must use Input primitive
    assert.match(
      calendarSource,
      /<Input[^>]*type="hidden"[^>]*name="status"[^>]*value=\{status\}/,
      "Form must include <Input type='hidden' name='status' value={status} />"
    );
  });

  test("R1: status options are rendered as an accessible radiogroup with 3 options and icons", () => {
    assert.match(
      calendarSource,
      /role="radiogroup"/,
      "Status section must use role='radiogroup'"
    );
    assert.match(
      calendarSource,
      /aria-label="Situação do plantão"/,
      "Status radiogroup must have aria-label='Situação do plantão'"
    );
    // 3 options with role="radio" and aria-checked
    assert.match(calendarSource, /aria-checked=\{status === "agendado"\}/);
    assert.match(calendarSource, /aria-checked=\{status === "realizado"\}/);
    assert.match(calendarSource, /aria-checked=\{status === "cancelado"\}/);

    // Enforce touch target >= 44px (min-h-[56px] preferred)
    assert.match(calendarSource, /min-h-\[56px\]/);

    // Visible focus indicator
    assert.match(calendarSource, /focus-visible:ring-2/);

    // Icons: CalendarDays, CheckCircle2, Ban
    assert.match(calendarSource, /CalendarDays/);
    assert.match(calendarSource, /CheckCircle2/);
    assert.match(calendarSource, /Ban/);
  });

  test("R1: keyboard arrow navigation (ArrowLeft / ArrowRight) is implemented for status selection", () => {
    assert.match(
      calendarSource,
      /ArrowLeft|ArrowRight/,
      "Radiogroup or status options must handle ArrowLeft and ArrowRight keyboard navigation"
    );
  });

  test("R2: footer actions are disambiguated with 'Fechar' and 'Salvar alterações'", () => {
    // Ambiguous Cancelar button must NOT exist in the standard footer
    assert.doesNotMatch(
      calendarSource,
      />\s*Cancelar\s*<\/Button>/,
      "Footer must NOT have an ambiguous 'Cancelar' button"
    );

    // Secondary button must be "Fechar"
    assert.match(
      calendarSource,
      />\s*Fechar\s*<\/Button>/,
      "Secondary button must be labeled 'Fechar'"
    );

    // Primary button must be "Salvar alterações" (with busy indicator)
    assert.match(
      calendarSource,
      />\s*\{busy \? "Salvando\.\.\." : "Salvar alterações"\}\s*<\/Button>/,
      "Primary button must be labeled 'Salvar alterações'"
    );

    // Confirmation buttons when cancel confirmation is active
    assert.match(
      calendarSource,
      />\s*Voltar\s*<\/Button>/,
      "Confirmation state must have 'Voltar' button"
    );
    assert.match(
      calendarSource,
      />\s*\{busy \? "Cancelando\.\.\." : "Confirmar cancelamento"\}\s*<\/Button>/,
      "Confirmation state must have 'Confirmar cancelamento' primary button"
    );
  });

  test("R3: source code implements isBecomingCanceled logic and inline confirmation alert", () => {
    assert.match(
      calendarSource,
      /const\s+isBecomingCanceled\s*=\s*status\s*===\s*"cancelado"\s*&&\s*\(!shift\s*\|\|\s*shift\.status\s*!==\s*"cancelado"\);/,
      "Must define isBecomingCanceled checking status and shift"
    );
    assert.match(
      calendarSource,
      /if\s*\(isBecomingCanceled\s*&&\s*!confirmCancel\)\s*\{\s*setConfirmCancel\(true\);\s*return;\s*\}/,
      "onSubmit must check isBecomingCanceled && !confirmCancel before triggering confirmation"
    );
    assert.match(
      calendarSource,
      /isBecomingCanceled\s*&&\s*confirmCancel/,
      "Confirmation alert and buttons must be guarded by isBecomingCanceled && confirmCancel"
    );
    assert.match(
      calendarSource,
      /role="alert"/,
      "Confirmation warning must have role='alert'"
    );
  });
});

/* ========================================================================= */
/* SUITE 2: DETERMINISTIC BEHAVIORAL STATE TRANSITION SIMULATIONS            */
/* ========================================================================= */
describe("Shift Calendar Modal: State Transition Simulation", () => {
  const STATUSES = ["agendado", "realizado", "cancelado"];

  function createFormSimulation({ shift, initialStatus }) {
    let status = initialStatus ?? (shift ? shift.status : "agendado");
    let confirmCancel = false;
    let saveCount = 0;

    function handleStatusChange(newStatus) {
      status = newStatus;
      if (newStatus !== "cancelado") {
        confirmCancel = false;
      }
    }

    function handleKeyDown(key) {
      const currentIndex = STATUSES.indexOf(status);
      if (key === "ArrowRight" || key === "ArrowDown") {
        const nextIndex = (currentIndex + 1) % STATUSES.length;
        handleStatusChange(STATUSES[nextIndex]);
      } else if (key === "ArrowLeft" || key === "ArrowUp") {
        const prevIndex = (currentIndex - 1 + STATUSES.length) % STATUSES.length;
        handleStatusChange(STATUSES[prevIndex]);
      }
    }

    function submit() {
      const isBecomingCanceled =
        status === "cancelado" &&
        (!shift || shift.status !== "cancelado");

      if (isBecomingCanceled && !confirmCancel) {
        confirmCancel = true;
        return { status, confirmCancel, saved: false };
      }

      saveCount++;
      return { status, confirmCancel, saved: true };
    }

    return {
      getStatus: () => status,
      isConfirming: () => confirmCancel,
      getSaveCount: () => saveCount,
      handleStatusChange,
      handleKeyDown,
      setConfirmCancel: (val) => { confirmCancel = val; },
      submit,
    };
  }

  test("Cenário 1: Agendado -> Cancelado exige confirmação antes de salvar", () => {
    const form = createFormSimulation({
      shift: { id: "shift-1", status: "agendado" },
      initialStatus: "agendado",
    });

    form.handleStatusChange("cancelado");
    assert.equal(form.getStatus(), "cancelado");
    assert.equal(form.isConfirming(), false);

    // First submit triggers confirmation and does NOT save
    const res1 = form.submit();
    assert.equal(res1.saved, false, "Must NOT save immediately on first submit");
    assert.equal(form.isConfirming(), true, "Must enter confirmation state");
    assert.equal(form.getSaveCount(), 0);

    // Second submit confirms and saves
    const res2 = form.submit();
    assert.equal(res2.saved, true, "Must save after confirmation");
    assert.equal(form.getSaveCount(), 1);
  });

  test("Cenário 2: Realizado -> Cancelado exige confirmação antes de salvar", () => {
    const form = createFormSimulation({
      shift: { id: "shift-2", status: "realizado" },
      initialStatus: "realizado",
    });

    form.handleStatusChange("cancelado");
    assert.equal(form.getStatus(), "cancelado");
    assert.equal(form.isConfirming(), false);

    const res1 = form.submit();
    assert.equal(res1.saved, false, "Must NOT save immediately");
    assert.equal(form.isConfirming(), true, "Must enter confirmation state");
    assert.equal(form.getSaveCount(), 0);

    const res2 = form.submit();
    assert.equal(res2.saved, true);
    assert.equal(form.getSaveCount(), 1);
  });

  test("Cenário 3: Cancelado -> Cancelado salva direto sem confirmação redundante", () => {
    const form = createFormSimulation({
      shift: { id: "shift-3", status: "cancelado" },
      initialStatus: "cancelado",
    });

    assert.equal(form.getStatus(), "cancelado");
    assert.equal(form.isConfirming(), false);

    // Submitting directly saves without confirmation
    const res = form.submit();
    assert.equal(res.saved, true, "Must save immediately without confirmation dialog");
    assert.equal(form.isConfirming(), false);
    assert.equal(form.getSaveCount(), 1);
  });

  test("Cenário 4: Novo plantão criado direto como Cancelado exige confirmação", () => {
    const form = createFormSimulation({
      shift: undefined,
      initialStatus: "agendado",
    });

    form.handleStatusChange("cancelado");
    assert.equal(form.getStatus(), "cancelado");

    const res1 = form.submit();
    assert.equal(res1.saved, false, "Must NOT save immediately for new canceled shift");
    assert.equal(form.isConfirming(), true, "Must enter confirmation state");
    assert.equal(form.getSaveCount(), 0);

    const res2 = form.submit();
    assert.equal(res2.saved, true);
    assert.equal(form.getSaveCount(), 1);
  });

  test("Cenário 5: Ao entrar em confirmação e trocar para Agendado ou Realizado, confirmação é limpa", () => {
    const form = createFormSimulation({
      shift: { id: "shift-5", status: "agendado" },
      initialStatus: "agendado",
    });

    // Enter confirmation
    form.handleStatusChange("cancelado");
    form.submit();
    assert.equal(form.isConfirming(), true);

    // Switch to agendado
    form.handleStatusChange("agendado");
    assert.equal(form.isConfirming(), false, "Switching to agendado must reset confirmCancel");
    assert.equal(form.submit().saved, true);

    // Enter confirmation again and switch to realizado
    form.handleStatusChange("cancelado");
    form.submit();
    assert.equal(form.isConfirming(), true);

    form.handleStatusChange("realizado");
    assert.equal(form.isConfirming(), false, "Switching to realizado must reset confirmCancel");
    assert.equal(form.submit().saved, true);
  });

  test("Navegação por setas (ArrowLeft / ArrowRight) altera o status ciclicamente", () => {
    const form = createFormSimulation({
      shift: { id: "shift-nav", status: "agendado" },
      initialStatus: "agendado",
    });

    assert.equal(form.getStatus(), "agendado");
    form.handleKeyDown("ArrowRight");
    assert.equal(form.getStatus(), "realizado");
    form.handleKeyDown("ArrowRight");
    assert.equal(form.getStatus(), "cancelado");

    form.handleKeyDown("ArrowLeft");
    assert.equal(form.getStatus(), "realizado");
    form.handleKeyDown("ArrowLeft");
    assert.equal(form.getStatus(), "agendado");
  });
});
