import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return {
        url: "data:text/javascript,export const createServerClient = (_url, _key, options) => { globalThis.publicPagesOptions = options; return globalThis.publicPagesClient; }",
        shortCircuit: true,
      };
    }
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
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { NextRequest } = await import("next/server.js");
const { updateSession } = await import("../src/lib/auth/session.ts");

function createReq(path) {
  return new NextRequest(`http://localhost${path}`, { headers: { host: "localhost" } });
}

test("unauthenticated visitor can access public and legal pages freely", async () => {
  globalThis.publicPagesClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  };

  const publicPaths = [
    "/",
    "/login",
    "/cadastro",
    "/esqueci-senha",
    "/redefinir-senha",
    "/privacidade",
    "/termos",
    "/suporte",
    "/auth/callback",
  ];

  for (const path of publicPaths) {
    const res = await updateSession(createReq(path));
    assert.equal(
      res.status,
      200,
      `Expected unauthenticated access to ${path} to be allowed (200), got ${res.status}`
    );
  }
});

test("unauthenticated visitor to protected route is redirected to /login with next param", async () => {
  globalThis.publicPagesClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  };

  const protectedPaths = ["/dashboard", "/calendario", "/pagamentos", "/historico", "/perfil"];

  for (const path of protectedPaths) {
    const res = await updateSession(createReq(path));
    assert.equal(res.status, 307);
    const location = res.headers.get("location");
    assert.ok(location?.startsWith("http://localhost/login"));
    assert.ok(location?.includes(`next=${encodeURIComponent(path)}`));
  }
});

test("authenticated user accessing /login, /cadastro or /esqueci-senha is redirected to dashboard", async () => {
  globalThis.publicPagesClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: "test-user-123" } }, error: null }),
    },
  };

  for (const path of ["/login", "/cadastro", "/esqueci-senha"]) {
    const res = await updateSession(createReq(path));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "http://localhost/dashboard");
  }
});

test("authenticated user can access /redefinir-senha, legal pages and dashboard without redirect loop", async () => {
  globalThis.publicPagesClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: "test-user-123" } }, error: null }),
    },
  };

  const allowedPaths = ["/redefinir-senha", "/privacidade", "/termos", "/suporte", "/dashboard"];

  for (const path of allowedPaths) {
    const res = await updateSession(createReq(path));
    assert.equal(res.status, 200, `Expected ${path} to be allowed for authenticated user`);
  }
});
