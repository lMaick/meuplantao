import test from "node:test";
import assert from "node:assert/strict";
import { createSubmitOnce } from "../src/lib/places/submit-once.ts";

test("envios simultâneos do formulário compartilham uma única criação do local", async () => {
  let calls = 0;
  let finish;
  const submit = createSubmitOnce(() => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  });

  const first = submit();
  const second = submit();
  assert.equal(calls, 1);
  finish({ id: "place-1" });
  assert.deepEqual(await Promise.all([first, second]), [{ id: "place-1" }, { id: "place-1" }]);
});

test("um novo envio é permitido depois que a criação anterior falha", async () => {
  let calls = 0;
  const submit = createSubmitOnce(async () => {
    calls += 1;
    if (calls === 1) throw new Error("falha temporária");
    return { id: "place-2" };
  });
  await assert.rejects(submit(), /falha temporária/);
  assert.deepEqual(await submit(), { id: "place-2" });
});
