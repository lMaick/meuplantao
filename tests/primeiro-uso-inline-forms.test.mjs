import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("onboarding do dashboard leva direto ao formulario de plantao", () => {
  const src = read("src/components/dashboard/dashboard.tsx");
  assert.ok(src.includes("Lançar meu primeiro plantão"));
  assert.ok(src.includes('href="/calendario?novo=1"'));
  assert.ok(!src.includes("1 de 2"));
});

test("campos embutidos nao usam <form>, name nem submit", () => {
  for (const file of ["inline-place-form", "inline-contact-form"]) {
    const src = read(`src/components/shifts/${file}.tsx`);
    assert.ok(!/<form[\s>]/.test(src), `${file} nao pode aninhar <form>`);
    assert.ok(!/\sname=/.test(src), `${file} nao pode ter name (entraria no FormData do plantao)`);
    assert.ok(!/type="submit"/.test(src), `${file} nao pode disparar submit do plantao`);
    assert.ok(src.includes('role="alert"'), `${file} mostra erro com role=alert`);
    assert.ok(src.includes("preventDefault"), `${file} intercepta Enter`);
  }
  assert.ok(read("src/components/shifts/inline-place-form.tsx").includes("createPlace"));
  assert.ok(read("src/components/shifts/inline-contact-form.tsx").includes("createContact"));
});

test("calendario usa os blocos embutidos e mantem contratos", () => {
  const src = read("src/components/shifts/shift-calendar.tsx");
  assert.ok(src.includes("+ Novo local") && src.includes("+ Novo pagador"));
  assert.ok(src.includes("InlinePlaceForm") && src.includes("InlineContactForm"));
  assert.ok(!/\bcreateShift\(|\bupdateShift\(/.test(src));
});
