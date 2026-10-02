import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return {
        url: "data:text/javascript,export const createServerClient = () => ({ auth: { getUser: async () => { globalThis.__getUserCalls = (globalThis.__getUserCalls || 0) + 1; return { data: { user: globalThis.__mockUser || null }, error: null }; } } });",
        shortCircuit: true,
      };
    }
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
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { NextRequest } = await import("next/server.js");
const { isMachineToMachineRoute, MACHINE_TO_MACHINE_PATHS, updateSession } = await import("../src/lib/auth/session.ts");

function createReq(url, method = "GET") {
  return new NextRequest(url, { method });
}

test("MAI-151: rotas M2M chegam ao handler SEM chamar auth.getUser", async () => {
  const { readFileSync } = await import("node:fs");
  const sessionSource = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
  const m2mIndex = sessionSource.indexOf("if (isMachineToMachineRoute(pathname))");
  const getUserIndex = sessionSource.indexOf("supabase.auth.getUser");
  assert.ok(m2mIndex !== -1, "updateSession deve classificar M2M via isMachineToMachineRoute");
  assert.ok(getUserIndex !== -1, "updateSession ainda autentica rotas com sessão");
  assert.ok(m2mIndex < getUserIndex, "classificação M2M deve vir ANTES de auth.getUser");

  const middlewareSource = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.ok(middlewareSource.includes("isMachineToMachineRoute"), "middleware deve classificar M2M antes da sessão");
  assert.ok(middlewareSource.includes("shouldSendHsts"), "middleware mantém wrapper HSTS para M2M");
  assert.ok(!middlewareSource.includes('startsWith("/api")'), "sem bypass genérico /api/* no middleware");
  assert.ok(!sessionSource.includes('startsWith("/api")'), "sem bypass genérico /api/* na sessão");
  assert.deepEqual(
    [...MACHINE_TO_MACHINE_PATHS].sort(),
    ["/api/csp-report", "/api/webhooks/mercadopago", "/api/webhooks/mercadopago/ipn"].sort(),
    "allowlist M2M exata, sem ampliação",
  );

  const m2mRequests = [
    ["http://localhost/api/webhooks/mercadopago", "POST"],
    ["http://localhost/api/webhooks/mercadopago/ipn?id=12345&topic=payment", "GET"],
    ["http://localhost/api/webhooks/mercadopago/ipn", "POST"],
    ["http://localhost/api/csp-report", "POST"],
    ["http://localhost/api/csp-report", "GET"],
  ];
  for (const [url, method] of m2mRequests) {
    globalThis.__mockUser = null;
    globalThis.__getUserCalls = 0;
    const response = await updateSession(createReq(url, method));
    assert.equal(response.status, 200, `${method} ${url} deve chegar ao handler`);
    assert.equal(response.headers.get("location"), null, `${method} ${url} NÃO deve redirecionar`);
    assert.equal(globalThis.__getUserCalls, 0, `${method} ${url} NÃO deve chamar auth.getUser`);
    assert.equal(isMachineToMachineRoute(new URL(url).pathname), true);
  }

  // M2M funciona mesmo sem config Supabase (prova de que Auth não é necessária).
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    globalThis.__getUserCalls = 0;
    const response = await updateSession(createReq("http://localhost/api/webhooks/mercadopago", "POST"));
    assert.equal(response.status, 200, "M2M sem config ainda chega ao handler");
    assert.equal(globalThis.__getUserCalls, 0, "M2M sem config NÃO deve chamar auth.getUser");
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  }

  // Rotas privadas continuam exigindo sessão (getUser chamado + redirect).
  globalThis.__mockUser = null;
  globalThis.__getUserCalls = 0;
  const privateResponse = await updateSession(createReq("http://localhost/dashboard"));
  assert.equal(privateResponse.status, 307);
  assert.ok(globalThis.__getUserCalls >= 1, "rota privada deve consultar auth.getUser");
});

test("Sem sessão: POST /api/webhooks/mercadopago chega ao handler (não redireciona)", async () => {
  globalThis.__mockUser = null;
  const req = createReq("http://localhost/api/webhooks/mercadopago", "POST");
  const response = await updateSession(req);

  assert.equal(response.status, 200, "Deve retornar status 200/next para o handler");
  assert.equal(response.headers.get("location"), null, "NÃO deve redirecionar para /login");
});

test("Sem sessão: GET /api/webhooks/mercadopago/ipn chega ao handler (não redireciona)", async () => {
  globalThis.__mockUser = null;
  const req = createReq("http://localhost/api/webhooks/mercadopago/ipn?id=12345&topic=payment", "GET");
  const response = await updateSession(req);

  assert.equal(response.status, 200, "Deve retornar status 200/next para o handler IPN");
  assert.equal(response.headers.get("location"), null, "NÃO deve redirecionar para /login");
});

test("Sem sessão: POST /api/webhooks/mercadopago/ipn chega ao handler (não redireciona)", async () => {
  globalThis.__mockUser = null;
  const req = createReq("http://localhost/api/webhooks/mercadopago/ipn", "POST");
  const response = await updateSession(req);

  assert.equal(response.status, 200, "Deve retornar status 200/next para o handler IPN");
  assert.equal(response.headers.get("location"), null, "NÃO deve redirecionar para /login");
});

test("Sem sessão: POST /api/csp-report chega ao handler (não redireciona)", async () => {
  globalThis.__mockUser = null;
  const req = createReq("http://localhost/api/csp-report", "POST");
  const response = await updateSession(req);

  assert.equal(response.status, 200, "Deve retornar status 200/next para o handler");
  assert.equal(response.headers.get("location"), null, "NÃO deve redirecionar para /login");
});

test("Sem sessão: GET /api/csp-report chega ao handler (não redireciona)", async () => {
  globalThis.__mockUser = null;
  const req = createReq("http://localhost/api/csp-report", "GET");
  const response = await updateSession(req);

  assert.equal(response.status, 200, "Deve retornar status 200/next para o handler");
  assert.equal(response.headers.get("location"), null, "NÃO deve redirecionar para /login");
});

test("Sem sessão: rotas privadas ou não autorizadas continuam exigindo autenticação", async () => {
  globalThis.__mockUser = null;

  const privatePaths = [
    "/dashboard",
    "/pagamentos",
    "/alertas",
    "/calendario",
    "/api/mercadopago/verify",
    "/api/mercadopago/checkout",
    "/api/mercadopago/sync",
    "/api/webhooks/mercadopago/fake",
    "/api/webhooks/mercadopago-other",
  ];

  for (const path of privatePaths) {
    const req = createReq(`http://localhost${path}`);
    const response = await updateSession(req);

    assert.equal(response.status, 307, `Rota ${path} deve redirecionar com status 307`);
    assert.match(
      response.headers.get("location") || "",
      new RegExp(`^http://localhost/login\\?next=${encodeURIComponent(path)}`),
      `Rota ${path} deve redirecionar para /login com param next`,
    );
  }
});
