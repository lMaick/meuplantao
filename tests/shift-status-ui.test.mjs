import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const calendarPath = path.join(ROOT, "src/components/shifts/shift-calendar.tsx");
const calendarSource = fs.readFileSync(calendarPath, "utf8");

test("shift-calendar: status dropdown is removed in favor of a visible selection component", () => {
  assert.doesNotMatch(
    calendarSource,
    /<Select[^>]*name="status"/,
    "Status must NOT use a dropdown Select component"
  );
  assert.match(
    calendarSource,
    /<(Input|input)[^>]*type="hidden"[^>]*name="status"[^>]*value=\{status\}/,
    "Form must include a hidden input for status to guarantee FormData serialization"
  );
});

test("shift-calendar: status options are rendered as an accessible radiogroup with 3 options", () => {
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

  // Each card enforces >= 44px touch targets
  assert.match(calendarSource, /min-h-\[56px\]/);
});

test("shift-calendar: footer actions are disambiguated with 'Fechar' and 'Salvar alterações'", () => {
  // Must NOT have ambiguous "Cancelar" button in footer
  assert.doesNotMatch(
    calendarSource,
    />\s*Cancelar\s*<\/Button>/,
    "Footer must NOT have ambiguous 'Cancelar' button"
  );

  // Secondary button must be "Fechar"
  assert.match(
    calendarSource,
    />\s*Fechar\s*<\/Button>/,
    "Secondary button must be clearly labeled 'Fechar'"
  );

  // Primary button must be "Salvar alterações"
  assert.match(
    calendarSource,
    />\s*\{busy \? "Salvando\.\.\." : "Salvar alterações"\}\s*<\/Button>/,
    "Primary button must be labeled 'Salvar alterações'"
  );
});

test("shift-calendar: source implementation uses isBecomingCanceled logic", () => {
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
});

// State transition simulation mirroring Form component in shift-calendar.tsx
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
    setConfirmCancel: (val) => { confirmCancel = val; },
    submit,
  };
}

test("transição 1: Agendado -> Cancelado exige confirmação", () => {
  const form = createFormSimulation({
    shift: { id: "shift-1", status: "agendado" },
    initialStatus: "agendado",
  });

  // User changes status to cancelado
  form.handleStatusChange("cancelado");
  assert.equal(form.getStatus(), "cancelado");
  assert.equal(form.isConfirming(), false);

  // First submit should NOT save; must trigger confirmation
  const res1 = form.submit();
  assert.equal(res1.saved, false, "Must NOT save immediately on first submit");
  assert.equal(form.isConfirming(), true, "Must enter confirmation state");
  assert.equal(form.getSaveCount(), 0);

  // Second submit (with confirmCancel=true) should save
  const res2 = form.submit();
  assert.equal(res2.saved, true, "Must save after confirmation");
  assert.equal(form.getSaveCount(), 1);
});

test("transição 2: Realizado -> Cancelado exige confirmação", () => {
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

test("transição 3: Cancelado -> Cancelado salva sem pedir confirmação novamente", () => {
  const form = createFormSimulation({
    shift: { id: "shift-3", status: "cancelado" },
    initialStatus: "cancelado",
  });

  // Shift is already canceled; user edits another field without changing status
  assert.equal(form.getStatus(), "cancelado");
  assert.equal(form.isConfirming(), false);

  // Submit should save immediately without asking for confirmation again
  const res = form.submit();
  assert.equal(res.saved, true, "Must save immediately without confirmation dialog");
  assert.equal(form.isConfirming(), false, "Must not set confirmCancel");
  assert.equal(form.getSaveCount(), 1);
});

test("transição 4: Novo plantão criado diretamente como Cancelado exige confirmação", () => {
  const form = createFormSimulation({
    shift: undefined, // new shift
    initialStatus: "agendado",
  });

  // User sets status to cancelado on new shift
  form.handleStatusChange("cancelado");
  assert.equal(form.getStatus(), "cancelado");

  // First submit must trigger confirmation
  const res1 = form.submit();
  assert.equal(res1.saved, false, "Must NOT save immediately for new canceled shift");
  assert.equal(form.isConfirming(), true, "Must enter confirmation state");
  assert.equal(form.getSaveCount(), 0);

  // Confirming should save
  const res2 = form.submit();
  assert.equal(res2.saved, true);
  assert.equal(form.getSaveCount(), 1);
});

test("transição 5: Entrou na confirmação e mudou para Agendado ou Realizado limpa a confirmação", () => {
  const form = createFormSimulation({
    shift: { id: "shift-5", status: "agendado" },
    initialStatus: "agendado",
  });

  // User selects cancelado and submits, entering confirmation
  form.handleStatusChange("cancelado");
  form.submit();
  assert.equal(form.isConfirming(), true, "Entered confirmation");

  // User changes mind and selects agendado
  form.handleStatusChange("agendado");
  assert.equal(form.isConfirming(), false, "Changing to agendado must clear confirmation");
  assert.equal(form.getStatus(), "agendado");

  // If user submits with agendado, saves immediately without confirmation
  const resAgendado = form.submit();
  assert.equal(resAgendado.saved, true);

  // Test again for Realizado
  form.handleStatusChange("cancelado");
  form.submit();
  assert.equal(form.isConfirming(), true, "Entered confirmation again");

  form.handleStatusChange("realizado");
  assert.equal(form.isConfirming(), false, "Changing to realizado must clear confirmation");
  assert.equal(form.getStatus(), "realizado");

  const resRealizado = form.submit();
  assert.equal(resRealizado.saved, true);
});
