import assert from "node:assert/strict";
import test from "node:test";
import { authCallbackUrl, safeNext } from "../src/lib/auth/redirect.ts";
import { readFile } from "node:fs/promises";

test("preserves local destination with query and fragment", () => {
  assert.equal(safeNext("/calendario?dia=2026-09-05#novo"), "/calendario?dia=2026-09-05#novo");
});

test("rejects external redirects, malformed values and authentication loops", () => {
  for (const value of [undefined, ["/locais"], "https://example.com", "//example.com", "/\\example.com", "/\n/example.com", "/login?next=/login", "/cadastro", ""]) {
    assert.equal(safeNext(value), "/dashboard");
  }
});

test("builds a same-origin callback and sanitizes next", () => {
  assert.equal(authCallbackUrl("http://localhost:3000", "/calendario"), "http://localhost:3000/auth/callback?next=%2Fcalendario");
  assert.match(authCallbackUrl("https://app.example", "https://evil.example"), /next=%2Fdashboard/);
  assert.throws(() => authCallbackUrl("https://user:pass@app.example", "/dashboard"));
});

test("offers GitHub OAuth with the same safe callback contract", async () => {
  const source = await readFile(new URL("../src/lib/auth/auth-forms.tsx", import.meta.url), "utf8");
  assert.match(source, /provider: "google" \| "github"/);
  assert.match(source, /handleOAuthSignIn\("github"\)/);
  assert.match(source, /Continuar com GitHub/);
  assert.match(source, /authCallbackUrl\(window\.location\.origin, next\)/);
});

test("callback handles provider cancellation without exposing provider details", async () => {
  const source = await readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
  assert.match(source, /searchParams\.has\("error"\)/);
  assert.match(source, /url\.searchParams\.set\("error", "oauth"\)/);
  assert.match(source, /url\.searchParams\.set\("next", next\)/);
  assert.doesNotMatch(source, /error_description/);
});
