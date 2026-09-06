import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/20260906120000_atomic_shift_obligation.sql", "utf8");
const ui = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");
const dal = fs.readFileSync("src/lib/shifts/index.ts", "utf8");
const removal = fs.readFileSync("supabase/migrations/20260906130000_remove_legacy_obligation_sync.sql", "utf8");

function save(state, input) {
  if (input.userId !== state.userId) throw new Error("ownership");
  if (input.status === "realizado" && (input.value === null || input.dueDate === null || (Boolean(input.placeId) === Boolean(input.contactId)))) throw new Error("obrigacao completa");
  if (input.placeOwner !== state.userId || (input.contactOwner && input.contactOwner !== state.userId)) throw new Error("foreign key");
  const existing = state.shift;
  const registered = existing?.obligation?.payments.filter((p) => p.status === "registrado").reduce((sum, p) => sum + p.value, 0) ?? 0;
  if (existing && input.status === "realizado" && input.value < registered) throw new Error("abaixo do recebido");
  if (existing && registered > 0 && existing.status === "realizado" && ["agendado", "cancelado"].includes(input.status)) throw new Error("transicao bloqueada");
  const shift = { ...existing, id: existing?.id ?? "shift-1", userId: state.userId, status: input.status, value: input.value };
  if (input.status === "realizado") shift.obligation = { ...(existing?.obligation ?? {}), value: input.value, dueDate: input.dueDate, placeId: input.placeId, contactId: input.contactId, payments: existing?.obligation?.payments ?? [] };
  state.shift = shift;
  return shift;
}

test("atomic RPC is the sole realized shift save path", () => {
  assert.match(migration, /save_shift_with_obligation/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /p_status = 'realizado'/);
  assert.match(migration, /exige valor, data prevista e exatamente um responsavel/);
  assert.match(migration, /v_registered/);
  assert.match(migration, /raise exception/);
  assert.match(dal, /rpc\("save_shift_with_obligation"/);
  assert.match(ui, /saveShiftWithObligation/);
  assert.doesNotMatch(ui, /updateObligation|createShift\(|updateShift\(/);
  assert.match(removal, /drop trigger if exists shifts_realized_obligation_value/);
  assert.match(removal, /drop function if exists public\.sync_realized_obligation_value/);
  assert.doesNotMatch(removal, /drop trigger.*(financial_integrity|realized_obligation_valid)/);
});

test("RPC contract is retry-safe and rolls back on validation failure", () => {
  assert.match(migration, /p_shift_id uuid/);
  assert.match(migration, /where id=p_shift_id and user_id=v_user_id/);
  assert.match(migration, /insert into public\.obligations/);
  assert.match(migration, /update public\.obligations/);
  assert.match(migration, /p_valor_previsto < v_registered/);
  assert.match(migration, /grant execute.*authenticated/);
  assert.match(migration, /revoke execute.*public, anon/);
});

test("RPC invariants cover scheduled, transitions, valid local/contact and exactly one obligation", () => {
  const state = { userId: "a", shift: null };
  assert.equal(save(state, { userId: "a", status: "agendado", value: null, placeId: "p", placeOwner: "a", dueDate: null }).obligation, undefined);
  const realized = save(state, { userId: "a", status: "realizado", value: 100, placeId: "p", placeOwner: "a", contactId: null, dueDate: "2026-09-10" });
  assert.equal(realized.obligation.placeId, "p");
  assert.equal(Object.values(realized.obligation).filter(Boolean).length > 0, true);
  const contact = save(state, { userId: "a", status: "realizado", value: 120, placeId: null, placeOwner: "a", contactId: "c", contactOwner: "a", dueDate: "2026-09-11" });
  assert.equal(contact.obligation.contactId, "c");
  assert.equal(contact.obligation.placeId, null);
  assert.throws(() => save(state, { userId: "a", status: "realizado", value: 120, placeId: null, placeOwner: "a", contactId: "c", contactOwner: "a", dueDate: null }), /obrigacao/);
  assert.throws(() => save(state, { userId: "a", status: "realizado", value: 120, placeId: null, placeOwner: "a", contactId: null, dueDate: "2026-09-11" }), /obrigacao/);
});

test("RPC blocks cross-user owners, rolls back obligation failure and is idempotent on retry", () => {
  const state = { userId: "a", shift: null };
  assert.throws(() => save(state, { userId: "a", status: "realizado", value: 50, placeId: "p", placeOwner: "b", dueDate: "2026-09-10" }), /foreign key/);
  assert.throws(() => save(state, { userId: "a", status: "realizado", value: 50, placeId: null, placeOwner: "a", contactId: "c", contactOwner: "b", dueDate: "2026-09-10" }), /foreign key/);
  const first = save(state, { userId: "a", status: "realizado", value: 100, placeId: "p", placeOwner: "a", dueDate: "2026-09-10" });
  const before = JSON.stringify(state.shift);
  assert.throws(() => save(state, { userId: "a", status: "realizado", value: 80, placeId: null, placeOwner: "a", contactId: "c", contactOwner: "b", dueDate: "2026-09-11" }), /foreign key/);
  assert.equal(JSON.stringify(state.shift), before);
  const retry = save(state, { userId: "a", status: "realizado", value: 100, placeId: "p", placeOwner: "a", dueDate: "2026-09-10" });
  assert.equal(retry.id, first.id);
  assert.equal(state.shift.obligation.payments.length, 0);
});

test("RPC allows increase and blocks reduction/reversal with registered payment", () => {
  const state = { userId: "a", shift: null };
  save(state, { userId: "a", status: "realizado", value: 100, placeId: "p", placeOwner: "a", dueDate: "2026-09-10" });
  state.shift.obligation.payments.push({ value: 60, status: "registrado" });
  assert.equal(save(state, { userId: "a", status: "realizado", value: 120, placeId: "p", placeOwner: "a", dueDate: "2026-09-11" }).value, 120);
  assert.throws(() => save(state, { userId: "a", status: "realizado", value: 59, placeId: "p", placeOwner: "a", dueDate: "2026-09-11" }), /abaixo/);
  assert.throws(() => save(state, { userId: "a", status: "agendado", value: null, placeId: "p", placeOwner: "a", dueDate: null }), /transicao/);
  assert.throws(() => save(state, { userId: "a", status: "cancelado", value: null, placeId: "p", placeOwner: "a", dueDate: null }), /transicao/);
});
