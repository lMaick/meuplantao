import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { BulkCreateSession, MAX_BULK_DATES, normalizeBulkDates } from "../src/lib/shifts/bulk-create.ts";

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

function fakeServer({ failDates = new Set() } = {}) {
  const calls = [];
  const stored = new Map(); // idempotency: mesma chave => mesmo plantao
  const save = async ({ data, key }) => {
    calls.push({ data, key });
    if (failDates.has(data)) throw new Error(`falha em ${data}`);
    if (!stored.has(key)) stored.set(key, { id: `shift-${stored.size + 1}`, data });
    return stored.get(key);
  };
  return { calls, stored, save };
}

test("modulo puro: sem imports com alias e sem acesso a Supabase", () => {
  const src = fs.readFileSync("src/lib/shifts/bulk-create.ts", "utf8");
  assert.doesNotMatch(src, /from\s+["']@\//);
  assert.doesNotMatch(src, /supabase/i);
});

test("sucesso total: uma chave distinta por data, em sequencia", async () => {
  const server = fakeServer();
  const session = new BulkCreateSession(counter());
  const result = await session.run(server.save, ["2026-12-03", "2026-12-01", "2026-12-02", "2026-12-01"]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.saved.map((s) => s.data), ["2026-12-01", "2026-12-02", "2026-12-03"]);
  assert.equal(new Set(result.saved.map((s) => s.key)).size, 3);
  assert.equal(server.stored.size, 3);
  assert.deepEqual(session.pendingDates, []);
});

test("chave preset (intencao) vale para a data principal e nunca se repete", async () => {
  const server = fakeServer();
  const session = new BulkCreateSession(counter());
  assert.equal(session.keyFor("2026-12-01", "intent-key"), "intent-key");
  assert.notEqual(session.keyFor("2026-12-02", "intent-key"), "intent-key");
  const result = await session.run(server.save, ["2026-12-01", "2026-12-02"]);
  assert.equal(result.saved[0].key, "intent-key");
});

test("falha parcial: pendentes mantem as mesmas chaves e o erro identifica a data", async () => {
  const server = fakeServer({ failDates: new Set(["2026-12-02"]) });
  const session = new BulkCreateSession(counter());
  const first = await session.run(server.save, ["2026-12-01", "2026-12-02", "2026-12-03"]);
  assert.equal(first.complete, false);
  assert.deepEqual(first.saved.map((s) => s.data), ["2026-12-01", "2026-12-03"]);
  assert.equal(first.failed.length, 1);
  assert.equal(first.failed[0].data, "2026-12-02");
  assert.match(first.failed[0].message, /falha em 2026-12-02/);
  assert.deepEqual(session.pendingDates, ["2026-12-02"]);
  assert.equal(session.keyFor("2026-12-02"), first.failed[0].key);
});

test("reenvio nao duplica: so a data pendente e enviada, com a chave original", async () => {
  const failing = new Set(["2026-12-02"]);
  const server = fakeServer({ failDates: failing });
  const session = new BulkCreateSession(counter());
  const first = await session.run(server.save, ["2026-12-01", "2026-12-02", "2026-12-03"]);
  const failedKey = first.failed[0].key;
  const callsAfterFirst = server.calls.length;
  failing.clear();
  const second = await session.run(server.save);
  assert.equal(second.complete, true);
  assert.equal(server.calls.length, callsAfterFirst + 1);
  assert.deepEqual(server.calls.at(-1), { data: "2026-12-02", key: failedKey });
  assert.equal(server.stored.size, 3);
  // Terceiro envio: nada a fazer.
  const third = await session.run(server.save);
  assert.deepEqual(third.saved, []);
  assert.equal(server.calls.length, callsAfterFirst + 1);
});

test("falha repetida segue pendente com a mesma chave em todas as tentativas", async () => {
  const server = fakeServer({ failDates: new Set(["2026-12-05"]) });
  const session = new BulkCreateSession(counter());
  const a = await session.run(server.save, ["2026-12-05", "2026-12-06"]);
  const b = await session.run(server.save);
  const c = await session.run(server.save);
  assert.equal(a.failed[0].key, b.failed[0].key);
  assert.equal(b.failed[0].key, c.failed[0].key);
  assert.deepEqual(session.pendingDates, ["2026-12-05"]);
});

test("cancelar descarta chaves e progresso", async () => {
  const server = fakeServer();
  const session = new BulkCreateSession(counter());
  await session.run(server.save, ["2026-12-01"]);
  session.discard();
  assert.equal(session.isActive, false);
  assert.deepEqual(session.pendingDates, []);
  assert.throws(() => session.keyFor("2026-12-01"), /descartada/);
  await assert.rejects(() => session.run(server.save, ["2026-12-01"]), /descartada/);
});

test("normalizeBulkDates remove duplicadas e invalidas; limite exposto e 31", () => {
  assert.deepEqual(normalizeBulkDates(["2026-12-02", "x", "2026-12-01", "2026-12-02"]), ["2026-12-01", "2026-12-02"]);
  assert.equal(MAX_BULK_DATES, 31);
});

test("shift-calendar usa a sessao em lote sem createShift/updateShift", () => {
  const ui = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");
  assert.match(ui, /BulkCreateSession/);
  assert.match(ui, /saveShiftWithObligation/);
  assert.match(ui, /idempotency_key/);
  assert.doesNotMatch(ui, /\bcreateShift\(/);
  assert.doesNotMatch(ui, /\bupdateShift\(/);
});
