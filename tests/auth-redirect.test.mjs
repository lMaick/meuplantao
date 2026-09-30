import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// MAI-139: hook de resolução .ts para o import aninhado
// src/lib/auth/redirect.ts -> ../config/site-url
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { authCallbackUrl, oauthProviderConfig, safeNext } = await import("../src/lib/auth/redirect.ts");

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

test("MAI-139 (auditoria): em produção o callback OAuth usa a origem canônica e ignora origem forjada", () => {
  const snap = {
    site: process.env.NEXT_PUBLIC_SITE_URL,
    app: process.env.NEXT_PUBLIC_APP_URL,
    prod: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    preview: process.env.VERCEL_URL,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  };
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    assert.equal(
      authCallbackUrl("https://evil-attacker.example", "/calendario"),
      "https://meuplantao.pro/auth/callback?next=%2Fcalendario",
    );
    const config = oauthProviderConfig("google", "https://evil-attacker.example", "/calendario");
    assert.equal(config.options.redirectTo, "https://meuplantao.pro/auth/callback?next=%2Fcalendario");
  } finally {
    for (const [key, value] of Object.entries({
      NEXT_PUBLIC_SITE_URL: snap.site,
      NEXT_PUBLIC_APP_URL: snap.app,
      VERCEL_PROJECT_PRODUCTION_URL: snap.prod,
      VERCEL_URL: snap.preview,
      VERCEL_ENV: snap.vercelEnv,
      NODE_ENV: snap.nodeEnv,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
