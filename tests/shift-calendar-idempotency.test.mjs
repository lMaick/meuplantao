import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ShiftCreationIntent,
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
  const intent = ShiftCreationIntent.begin();
  const attempt1 = keyForShiftSave(true, intent);
  const attempt2 = keyForShiftSave(true, intent);
  assert.equal(attempt1, intent.keyForSubmit());
  assert.equal(attempt2, intent.keyForSubmit());
  assert.equal(attempt1, attempt2);
});

test("chave so e renovada em nova intencao e nunca em edicao", () => {
  const intent = ShiftCreationIntent.begin();
  assert.equal(keyForShiftSave(false, intent), null);
  assert.equal(keyForShiftSave(false, null), null);
  const nextIntent = ShiftCreationIntent.begin();
  assert.notEqual(nextIntent.keyForSubmit(), intent.keyForSubmit());
  assert.equal(keyForShiftSave(true, nextIntent), nextIntent.keyForSubmit());
});

test("calendario gera a chave na abertura da intencao e reutiliza no retry", () => {
  assert.match(ui, /idempotency/i);
  assert.match(ui, /ShiftCreationIntent/);
  assert.match(ui, /idempotency_key/);
  assert.match(ui, /saveShiftWithObligation/);
});

test("DAL propaga a chave ate a RPC sem segredo", () => {
  assert.match(dal, /p_idempotency_key/);
  assert.match(dal, /idempotency_key/);
});

test("ciclo idempotente real: mesma chave no retry, renovacao apos sucesso/cancelamento, edicao sem chave", async () => {
  const mod = await import("../src/lib/shifts/idempotency.ts");
  const calls = [];
  const fakeDalSave = async (id, input) => {
    calls.push({ id, key: input.idempotency_key });
    if (calls.length === 1) throw new Error("falha de rede simulada");
    return { id: id ?? "shift-novo" };
  };
  const submitNew = async (intent) => {
    const key = mod.keyForShiftSave(true, intent);
    return fakeDalSave(null, { idempotency_key: key });
  };
  let intent = mod.ShiftCreationIntent.begin();
  await assert.rejects(() => submitNew(intent), /falha de rede/);
  const retryResult = await submitNew(intent);
  assert.equal(retryResult.id, "shift-novo");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.match(calls[0].key, UUID_RE);
  intent.markSucceeded();
  assert.equal(intent.isActive, false);
  const firstKey = calls[0].key;
  intent = mod.ShiftCreationIntent.begin();
  await submitNew(intent);
  assert.notEqual(calls[2].key, firstKey);
  intent.markSucceeded();
  intent = mod.ShiftCreationIntent.begin();
  const beforeCancel = intent.keyForSubmit();
  intent.markCancelled();
  assert.equal(intent.isActive, false);
  intent = mod.ShiftCreationIntent.begin();
  assert.notEqual(intent.keyForSubmit(), beforeCancel);
  assert.equal(mod.keyForShiftSave(false, intent), null);
  assert.throws(() => mod.keyForShiftSave(true, null), /intent/);
});
