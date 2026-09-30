import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (existsSync(new URL(`${resolved.href}.ts`))) return nextResolve(`${resolved.href}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const siteUrl = await import("../src/lib/config/site-url.ts");
const redirect = await import("../src/lib/auth/redirect.ts");

const ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "VERCEL_ENV",
  "NODE_ENV",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearSiteConfig() {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
}

test("MAI-139: production browser alias keeps OAuth and recovery callbacks canonical", () => {
  const snapshot = snapshotEnv();
  const originalWindow = globalThis.window;
  try {
    clearSiteConfig();
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    globalThis.window = { location: { origin: "https://meuplantao.vercel.app" } };

    const browserOrigin = redirect.getClientOrigin(siteUrl.getCanonicalOrigin());
    const oauth = redirect.oauthProviderConfig("google", browserOrigin, "/dashboard");
    const recovery = redirect.authCallbackUrl(browserOrigin, "/redefinir-senha");

    assert.equal(oauth.options.redirectTo, "https://meuplantao.pro/auth/callback?next=%2Fdashboard");
    assert.equal(recovery, "https://meuplantao.pro/auth/callback?next=%2Fredefinir-senha");
  } finally {
    globalThis.window = originalWindow;
    restoreEnv(snapshot);
  }
});

test("MAI-139: production fails closed when only VERCEL_PROJECT_PRODUCTION_URL is set", () => {
  const snapshot = snapshotEnv();
  try {
    clearSiteConfig();
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "meuplantao.vercel.app";

    assert.throws(() => siteUrl.getSiteUrl(), /URL/);
  } finally {
    restoreEnv(snapshot);
  }
});

test("MAI-139: Preview still resolves the deployment-specific Vercel URL", () => {
  const snapshot = snapshotEnv();
  try {
    clearSiteConfig();
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    process.env.VERCEL_URL = "meuplantao-pr144-preview.vercel.app";

    assert.equal(siteUrl.getCanonicalOrigin(), "https://meuplantao-pr144-preview.vercel.app");
    const clientOrigin = redirect.getClientOrigin(siteUrl.getCanonicalOrigin());
    assert.equal(clientOrigin, "https://meuplantao-pr144-preview.vercel.app");
  } finally {
    restoreEnv(snapshot);
  }
});

test("MAI-139: interactive auth forms receive the server-resolved origin", () => {
  const authForm = readFileSync(new URL("../src/lib/auth/auth-forms.tsx", import.meta.url), "utf8");
  const loginPage = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  const signupPage = readFileSync(new URL("../src/app/cadastro/page.tsx", import.meta.url), "utf8");
  const recoveryPage = readFileSync(new URL("../src/app/esqueci-senha/page.tsx", import.meta.url), "utf8");
  const recoveryForm = readFileSync(new URL("../src/app/esqueci-senha/esqueci-senha-form.tsx", import.meta.url), "utf8");

  assert.match(authForm, /getClientOrigin\(authOrigin\)/);
  assert.doesNotMatch(authForm, /config\/site-url|window\.location/);
  assert.match(loginPage, /getCanonicalOrigin\(\)/);
  assert.match(loginPage, /authOrigin=\{authOrigin\}/);
  assert.match(signupPage, /getCanonicalOrigin\(\)/);
  assert.match(signupPage, /authOrigin=\{authOrigin\}/);
  assert.match(recoveryPage, /getCanonicalOrigin\(\)/);
  assert.match(recoveryPage, /authOrigin=\{authOrigin\}/);
  assert.match(recoveryForm, /getClientOrigin\(authOrigin\)/);
  assert.doesNotMatch(recoveryForm, /config\/site-url|window\.location/);
});
