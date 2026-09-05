import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { test } from "node:test";

// Exercise the real DAL with a fake Supabase boundary; no credentials or network.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return { url: "data:text/javascript,export const createServerClient = () => globalThis.jwtTestClient", shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "@/lib/supabase/client") {
      return { url: "data:text/javascript,export const createClient = () => globalThis.jwtTestClient", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const url = existsSync(new URL(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`;
      return nextResolve(url, context);
    }
    return nextResolve(specifier, context);
  },
});

test("dashboard DAL clears one local session before redirecting on concurrent future JWT failures", async () => {
  const events = [];
  globalThis.window = { location: { pathname: "/dashboard", replace: (url) => events.push(url) } };
  globalThis.jwtTestClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: { code: "bad_jwt", message: "JWT issued at future" } }),
      signOut: async (options) => { events.push(options); return { error: null }; },
    },
    from: () => assert.fail("must stop before querying data"),
  };
  try {
    const { listShifts } = await import("../src/lib/shifts/index.ts");
    const { listPayments } = await import("../src/lib/payments/index.ts");
    const { listPlaces } = await import("../src/lib/places/index.ts");
    const results = await Promise.allSettled([listShifts(), listPayments(), listPlaces()]);
    assert.deepEqual(events, [{ scope: "local" }, "/login?reason=session-expired"]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /Entre novamente/);
    }
  } finally {
    delete globalThis.window;
    delete globalThis.jwtTestClient;
  }
});

test("query errors recover too, while non-auth errors retain their message and cause", async () => {
  const { throwOnError } = await import("../src/lib/dal.ts");
  const queryError = { code: "23514", message: "Valor abaixo do saldo já pago" };
  await assert.rejects(throwOnError(queryError), (error) => {
    assert.equal(error.message, queryError.message);
    assert.equal(error.cause, queryError);
    return true;
  });
  const networkError = new Error("Failed to fetch");
  await assert.rejects(throwOnError(networkError), (error) => error === networkError);
  await throwOnError(null);
  globalThis.window = {};
  globalThis.jwtTestClient = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) },
    from: () => ({
      select: () => ({ eq: (column, value) => {
        assert.equal(column, "user_id");
        assert.equal(value, "user");
        return { order: async () => ({ data: null, error: { code: "PGRST301", message: "JWT expired" } }) };
      } }),
    }),
    rpc: async () => ({ data: null, error: { code: "PGRST301", message: "JWT expired" } }),
  };
  try {
    // The recovery already completed in the dashboard test: no second logout.
    const { listContacts } = await import("../src/lib/contacts/index.ts");
    const { createPayment } = await import("../src/lib/payments/index.ts");
    await assert.rejects(listContacts(), /Entre novamente/);
    await assert.rejects(createPayment({ shift_id: "shift", valor: 1, data_pagamento: "2026-09-05" }), /Entre novamente/);
  } finally {
    delete globalThis.window;
    delete globalThis.jwtTestClient;
  }
});

test("recovery login remains reachable when middleware still sees a valid Auth user", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  globalThis.jwtTestClient = { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } };
  try {
    const { NextRequest } = await import("next/server.js");
    const { updateSession } = await import("../src/lib/auth/session.ts");
    const recovered = await updateSession(new NextRequest("http://localhost/login?reason=session-expired"));
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("location"), null);
    const ordinary = await updateSession(new NextRequest("http://localhost/login"));
    assert.equal(ordinary.headers.get("location"), "http://localhost/dashboard");
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    delete globalThis.jwtTestClient;
  }
});
