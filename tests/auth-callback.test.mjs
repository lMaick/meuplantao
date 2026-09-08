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
    return nextResolve(specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
const { NextRequest } = await import("next/server.js");
const { GET } = await import("../src/app/auth/callback/route.ts");

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

test("callback preserves safe next on provider cancellation", async () => {
  globalThis.callbackClient = { auth: { exchangeCodeForSession: async () => assert.fail("must not exchange cancelled flow") } };
  const response = await GET(request("error=access_denied&error_description=private&next=%2Fcalendario"));
  assert.equal(response.headers.get("location"), "http://localhost/login?error=oauth&next=%2Fcalendario");
});
