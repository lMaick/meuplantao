import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/20260906120000_atomic_shift_obligation.sql", "utf8");
const ui = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");
const dal = fs.readFileSync("src/lib/shifts/index.ts", "utf8");

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
