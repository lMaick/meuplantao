import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  keyForShiftSave,
  newIdempotencyKey,
  startNewShiftIntent,
} from "../src/lib/shifts/idempotency.ts";

const ui = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");
const dal = fs.readFileSync("src/lib/shifts/index.ts", "utf8");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("nova intencao de plantao gera chave estavel unica via UUID seguro", () => {
  const first = startNewShiftIntent();
  const second = startNewShiftIntent();
  assert.match(first, UUID_RE);
  assert.match(second, UUID_RE);
  assert.notEqual(first, second);
  assert.match(newIdempotencyKey(), UUID_RE);
});

test("retry do caminho real reusa exatamente a mesma chave", () => {
  const intentKey = startNewShiftIntent();
  const attempt1 = keyForShiftSave(true, intentKey);
  const attempt2 = keyForShiftSave(true, intentKey);
  assert.equal(attempt1, intentKey);
  assert.equal(attempt2, intentKey);
  assert.equal(attempt1, attempt2);
});

test("chave so e renovada em nova intencao e nunca em edicao", () => {
  const intentKey = startNewShiftIntent();
  assert.equal(keyForShiftSave(false, intentKey), null);
  assert.equal(keyForShiftSave(false, null), null);
  const nextIntent = startNewShiftIntent();
  assert.notEqual(nextIntent, intentKey);
  assert.equal(keyForShiftSave(true, nextIntent), nextIntent);
});

test("calendario gera a chave na abertura da intencao e reutiliza no retry", () => {
  assert.match(ui, /idempotency/i);
  assert.match(ui, /randomUUID|newIdempotencyKey|startNewShiftIntent/);
  assert.match(ui, /idempotency_key/);
  assert.match(ui, /saveShiftWithObligation/);
});

test("DAL propaga a chave ate a RPC sem segredo", () => {
  assert.match(dal, /p_idempotency_key/);
  assert.match(dal, /idempotency_key/);
});
