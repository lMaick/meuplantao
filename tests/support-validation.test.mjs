import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { validateSupportSubmission } = await import("../src/lib/support/validation.ts");
const { allowSupportSubmission, resetSupportRateLimitForTesting } = await import("../src/lib/support/rate-limit.ts");

test("support form rejects empty fields and invalid email", () => {
  assert.deepEqual(validateSupportSubmission({ name: "", email: "a@b.com", subject: "Ajuda", message: "Oi" }), {
    ok: false,
    reason: "required",
  });
  assert.deepEqual(validateSupportSubmission({ name: "Ana", email: "inválido", subject: "Ajuda", message: "Oi" }), {
    ok: false,
    reason: "email",
  });
});

test("support form trims valid fields and removes line breaks from subject", () => {
  assert.deepEqual(validateSupportSubmission({
    name: " Ana ",
    email: " ana@example.com ",
    subject: "Ajuda\nBcc:alguem@example.com",
    message: " Olá ",
  }), {
    ok: true,
    data: {
      name: "Ana",
      email: "ana@example.com",
      subject: "Ajuda Bcc:alguem@example.com",
      message: "Olá",
    },
  });
});

test("support rate limit allows five messages per key and resets after the window", () => {
  resetSupportRateLimitForTesting();
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(allowSupportSubmission("client-a", 1000), true);
  assert.equal(allowSupportSubmission("client-a", 1000), false);
  assert.equal(allowSupportSubmission("client-b", 1000), true);
  assert.equal(allowSupportSubmission("client-a", 901_001), true);
  resetSupportRateLimitForTesting();
});

test("support form confirms only an explicit successful JSON response and gives a contact fallback", () => {
  const source = readFileSync(new URL("../src/components/support-form.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("if (response.ok && result?.ok === true)"));
  assert.ok(source.includes("escreva para contato@meuplantao.pro"));
});
