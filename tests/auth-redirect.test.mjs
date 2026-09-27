import assert from "node:assert/strict";
import test from "node:test";
import { authCallbackUrl, safeNext } from "../src/lib/auth/redirect.ts";
import { oauthProviderConfig } from "../src/lib/auth/redirect.ts";

test("preserves local destination with query and fragment", () => {
  assert.equal(safeNext("/calendario?dia=2026-09-05#novo"), "/calendario?dia=2026-09-05#novo");
});

test("rejects external redirects, malformed values and authentication loops", () => {
  for (const value of [undefined, ["/locais"], "https://example.com", "//example.com", "/\\example.com", "/\n/example.com", "/login?next=/login", "/cadastro", "/esqueci-senha", ""]) {
    assert.equal(safeNext(value), "/dashboard");
  }
});

test("allows recovery destination /redefinir-senha", () => {
  assert.equal(safeNext("/redefinir-senha"), "/redefinir-senha");
  assert.equal(safeNext("/redefinir-senha?code=test"), "/redefinir-senha?code=test");
});

test("builds a same-origin callback and sanitizes next", () => {
  assert.equal(authCallbackUrl("http://localhost:3000", "/calendario"), "http://localhost:3000/auth/callback?next=%2Fcalendario");
  assert.match(authCallbackUrl("https://app.example", "https://evil.example"), /next=%2Fdashboard/);
  assert.throws(() => authCallbackUrl("https://user:pass@app.example", "/dashboard"));
});

test("Google and GitHub use the same safe OAuth callback contract", () => {
  for (const provider of ["google", "github"]) {
    const config = oauthProviderConfig(provider, "https://app.example", "/calendario");
    assert.equal(config.provider, provider);
    assert.equal(config.options.redirectTo, "https://app.example/auth/callback?next=%2Fcalendario");
  }
});
