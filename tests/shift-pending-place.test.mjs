import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyPendingPlace, isAvailablePlace } from "../src/lib/shifts/pending-place.ts";

test("local recém-criado valida local e pagador mesmo com a lista anterior ao render", () => {
  const places = [{ id: "old" }];
  const pending = { id: "new", valor_padrao: 1250 };
  const data = new FormData();
  data.set("status", "realizado");
  data.set("valor_previsto", "");
  applyPendingPlace(data, pending);
  assert.equal(isAvailablePlace(String(data.get("place_id")), places, pending), true);
  assert.equal(isAvailablePlace(String(data.get("responsavel_id")), places, pending), true);
  assert.equal(data.get("valor_previsto"), "1250");
  assert.equal(data.get("responsavel_tipo"), "local");
  assert.equal(isAvailablePlace("unknown", places, pending), false);
  assert.equal(isAvailablePlace("new", places), false);
});

test("preserva valor explícito zero e pagador escolhido", () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ status: "realizado", valor_previsto: "0", responsavel_tipo: "contato", responsavel_id: "contact" })) data.set(key, value);
  applyPendingPlace(data, { id: "new", valor_padrao: 1200 });
  assert.equal(data.get("valor_previsto"), "0");
  assert.equal(data.get("responsavel_tipo"), "contato");
  assert.equal(data.get("responsavel_id"), "contact");
});

test("agendado com padrão zero mantém valor zero sem inventar pagador", () => {
  const data = new FormData();
  data.set("status", "agendado");
  applyPendingPlace(data, { id: "new", valor_padrao: 0 });
  assert.equal(data.get("valor_previsto"), "0");
  assert.equal(data.get("responsavel_id"), null);
});

// O fieldset fica disabled com busy, e o browser o exclui de FormData.
test("captura os campos antes de desabilitar o formulario e aguardar o local", () => {
  const source = readFileSync(new URL("../src/components/shifts/shift-calendar.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("onSubmit={(event) => {"));
  const capture = handler.indexOf("new FormData(event.currentTarget)");
  assert.ok(capture >= 0);
  assert.ok(capture < handler.indexOf("void run(async () => {"));
  assert.ok(capture < handler.indexOf("await submitPendingPlace?.()"));
  assert.match(handler, /applyPendingPlace\(data, pendingPlace\)/);
  assert.match(handler, /await save\(data, canRepeat \? extraDates : \[\], pendingPlace\)/);
});
