import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { test } from "node:test";

// Allow direct imports of source files that use the @/ alias.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const url = existsSync(new URL(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`;
      return nextResolve(url, context);
    }
    return nextResolve(specifier, context);
  },
});

const { OAUTH_CALLBACK_PATH, OAUTH_PROVIDER, buildOAuthCallbackUrl, getPublicSiteOrigin, resolveOAuthNext } = await import("../src/lib/auth/oauth.ts");

test("exposes a stable callback path and provider name", () => {
  assert.equal(OAUTH_CALLBACK_PATH, "/auth/callback");
  assert.equal(OAUTH_PROVIDER, "google");
});

test("builds absolute callback URLs for https and http origins", () => {
  assert.equal(buildOAuthCallbackUrl("https://meuplantao.example"), "https://meuplantao.example/auth/callback");
  assert.equal(buildOAuthCallbackUrl("http://localhost:3000"), "http://localhost:3000/auth/callback");
  assert.equal(buildOAuthCallbackUrl("https://meuplantao.example/"), "https://meuplantao.example/auth/callback");
  assert.equal(buildOAuthCallbackUrl("https://example.com"), "https://example.com/auth/callback");
});

test("uses a valid configured public origin and rejects unsafe values", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.meuplantao.example";
  assert.equal(getPublicSiteOrigin("http://localhost:3000"), "https://app.meuplantao.example");
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.meuplantao.example/path";
  assert.equal(getPublicSiteOrigin("http://localhost:3000"), "http://localhost:3000");
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previous;
});

test("falls back to a safe origin when the value is malformed or unsafe", () => {
  assert.equal(buildOAuthCallbackUrl("not a url"), "http://localhost/auth/callback");
  assert.equal(buildOAuthCallbackUrl(""), "http://localhost/auth/callback");
  assert.equal(buildOAuthCallbackUrl("ftp://example.com"), "http://localhost/auth/callback");
  assert.equal(buildOAuthCallbackUrl("file:///tmp/test"), "http://localhost/auth/callback");
});

test("resolveOAuthNext reuses safeNext rules and defaults to /dashboard", () => {
  assert.equal(resolveOAuthNext("/calendario"), "/calendario");
  assert.equal(resolveOAuthNext("/calendario?dia=2026-09-05"), "/calendario?dia=2026-09-05");
  assert.equal(resolveOAuthNext(undefined), "/dashboard");
  assert.equal(resolveOAuthNext("https://example.com"), "/dashboard");
  assert.equal(resolveOAuthNext(["/locais"]), "/dashboard");
  assert.equal(resolveOAuthNext("/login?next=/login"), "/dashboard");
  assert.equal(resolveOAuthNext("/cadastro"), "/dashboard");
  assert.equal(resolveOAuthNext(""), "/dashboard");
});

test("callback path is rooted and never external", () => {
  // The client builds `${origin}${OAUTH_CALLBACK_PATH}?next=...`. The path must
  // be absolute, single-leading-slash, and free of double-slashes so the hand-off
  // does not break across origins.
  assert.match(OAUTH_CALLBACK_PATH, /^\//);
  assert.equal(OAUTH_CALLBACK_PATH.startsWith("//"), false);
  assert.equal(OAUTH_CALLBACK_PATH.includes("://"), false);
});
