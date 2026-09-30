import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") return { url: "data:text/javascript,export const createServerClient = (_url, _key, options) => { globalThis.callbackOptions = options; return globalThis.callbackClient; }", shortCircuit: true };
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const url = existsSync(new URL(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`;
      return nextResolve(url, context);
    }
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

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
const { NextRequest } = await import("next/server.js");
const { GET } = await import("../src/app/auth/callback/route.ts");
const { updateSession } = await import("../src/lib/auth/session.ts");
const { oauthProviderConfig } = await import("../src/lib/auth/redirect.ts");
const { logoutAndRedirect } = await import("../src/lib/auth/logout.ts");

function request(query = "code=ok&next=%2Fdashboard") {
  return new NextRequest(`http://localhost/auth/callback?${query}`, { headers: { cookie: "sb-old=1" } });
}

test("callback exchanges code, persists auth cookies, and redirects to safe next", async () => {
  const calls = [];
  globalThis.callbackClient = { auth: { exchangeCodeForSession: async (code) => { calls.push(code); globalThis.callbackOptions.cookies.setAll([{ name: "sb-access-token", value: "session", options: { httpOnly: true } }]); return { error: null }; } } };
  const response = await GET(request());
  assert.deepEqual(calls, ["ok"]);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/dashboard");
  assert.match(response.headers.get("set-cookie"), /sb-access-token=session/);
});

for (const [name, exchange] of [["provider failure", async () => ({ error: new Error("provider detail") })], ["exchange exception", async () => { throw new Error("network detail"); }]]) {
  test(`callback converts ${name} to a generic safe redirect`, async () => {
    globalThis.callbackClient = { auth: { exchangeCodeForSession: exchange } };
    const response = await GET(request("code=ok&next=https%3A%2F%2Fevil.example"));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "http://localhost/login?error=oauth&next=%2Fdashboard");
  });
}

test("callback redirects to /redefinir-senha on successful recovery exchange", async () => {
  const calls = [];
  globalThis.callbackClient = {
    auth: {
      exchangeCodeForSession: async (code) => {
        calls.push(code);
        globalThis.callbackOptions.cookies.setAll([{ name: "sb-access-token", value: "recovery-session", options: { httpOnly: true } }]);
        return { error: null };
      },
    },
  };
  const response = await GET(request("code=recovery-code&next=%2Fredefinir-senha"));
  assert.deepEqual(calls, ["recovery-code"]);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/redefinir-senha");
  assert.match(response.headers.get("set-cookie"), /sb-access-token=recovery-session/);
});

test("callback redirects to /esqueci-senha with link_expired when recovery flow exchange fails", async () => {
  globalThis.callbackClient = {
    auth: {
      exchangeCodeForSession: async () => ({ error: new Error("otp_expired") }),
    },
  };
  const response = await GET(request("code=bad-code&next=%2Fredefinir-senha"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/esqueci-senha?error=link_expired");
});

test("callback preserves safe next on provider cancellation", async () => {
  globalThis.callbackClient = { auth: { exchangeCodeForSession: async () => assert.fail("must not exchange cancelled flow") } };
  const response = await GET(request("error=access_denied&error_description=private&next=%2Fcalendario"));
  assert.equal(response.headers.get("location"), "http://localhost/login?error=oauth&next=%2Fcalendario");
});

test("Preview OAuth flow keeps the Preview origin through session refresh and logout", async () => {
  const preview = "https://meuplantao-b534j60g3-lmaick.vercel.app";
  for (const provider of ["google", "github"]) {
    assert.equal(oauthProviderConfig(provider, preview, "/").options.redirectTo, `${preview}/auth/callback?next=%2F`);
  }

  const events = [];
  globalThis.callbackClient = {
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { id: "preview-user" } }, error: null }),
      signOut: async () => { events.push("signOut"); return { error: null }; },
    },
  };
  const callback = await GET(new NextRequest(`${preview}/auth/callback?code=preview-code&next=%2F`));
  assert.equal(callback.headers.get("location"), `${preview}/`);
  const refreshed = await updateSession(new NextRequest(`${preview}/dashboard`));
  assert.equal(refreshed.status, 200);
  const redirects = [];
  assert.equal(await logoutAndRedirect(() => globalThis.callbackClient.auth.signOut(), (path) => redirects.push(path)), true);
  assert.deepEqual(events, ["signOut"]);
  assert.deepEqual(redirects, ["/login"]);
});

test("MAI-139 (auditoria): em produção o callback ignora Host forjado e usa a origem canônica", async () => {
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
    globalThis.callbackClient = { auth: { exchangeCodeForSession: async () => ({ error: null }) } };
    const ok = await GET(new NextRequest("https://evil-attacker.example/auth/callback?code=ok&next=%2Fdashboard"));
    assert.equal(ok.headers.get("location"), "https://meuplantao.pro/dashboard");
    globalThis.callbackClient = { auth: { exchangeCodeForSession: async () => ({ error: new Error("otp_expired") }) } };
    const expired = await GET(new NextRequest("https://evil-attacker.example/auth/callback?code=bad&next=%2Fredefinir-senha"));
    assert.equal(expired.headers.get("location"), "https://meuplantao.pro/esqueci-senha?error=link_expired");
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
