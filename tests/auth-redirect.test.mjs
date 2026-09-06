import assert from "node:assert/strict";
import test from "node:test";
import { authCallbackUrl, safeNext } from "../src/lib/auth/redirect.ts";

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
