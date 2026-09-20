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

test("shift-calendar: cancellation confirmation alert is present before persisting canceled status", () => {
  assert.match(
    calendarSource,
    /confirmCancel && status === "cancelado"/,
    "Must check confirmCancel when status is cancelado"
  );
  assert.match(
    calendarSource,
    /Confirmar cancelamento do plantão\?/,
    "Must display cancellation confirmation title"
  );
  assert.match(
    calendarSource,
    /Confirmar cancelamento/,
    "Must offer 'Confirmar cancelamento' primary action"
  );
  assert.match(
    calendarSource,
    /Voltar/,
    "Must offer 'Voltar' action to dismiss confirmation"
  );
});
