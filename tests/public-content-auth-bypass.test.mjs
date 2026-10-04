import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return {
        url: "data:text/javascript,export const createServerClient = () => { globalThis.__clientCalls = (globalThis.__clientCalls || 0) + 1; return { auth: { getUser: async () => { globalThis.__getUserCalls = (globalThis.__getUserCalls || 0) + 1; return { data: { user: globalThis.__mockUser || null }, error: null }; } } }; };",
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
const {
  isMachineToMachineRoute,
  isPublicSeoRoute,
  isPublicContentRoute,
  MACHINE_TO_MACHINE_PATHS,
  PUBLIC_SEO_PATHS,
  PUBLIC_CONTENT_PATHS,
  updateSession,
} = await import("../src/lib/auth/session.ts");

function createReq(url, method = "GET") {
  return new NextRequest(url, { method });
}

function resetCounters() {
  globalThis.__mockUser = null;
  globalThis.__getUserCalls = 0;
  globalThis.__clientCalls = 0;
}

test("MAI-160: allowlist PUBLIC_CONTENT_PATHS exata e classificação antes do Auth", async () => {
  const { readFileSync } = await import("node:fs");
  const sessionSource = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
  const contentIndex = sessionSource.indexOf("if (isPublicContentRoute(pathname))");
  const getUserIndex = sessionSource.indexOf("supabase.auth.getUser");
  const createClientIndex = sessionSource.indexOf("createRequestClient(request, response, config)");
  assert.ok(contentIndex !== -1, "updateSession deve classificar conteúdo público via isPublicContentRoute");
  assert.ok(getUserIndex !== -1, "updateSession ainda autentica rotas com sessão");
  assert.ok(contentIndex < getUserIndex, "classificação de conteúdo público deve vir ANTES de auth.getUser");
  assert.ok(
    contentIndex < createClientIndex,
    "classificação de conteúdo público deve vir ANTES de criar o client Supabase",
  );

  const middlewareSource = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.ok(middlewareSource.includes("isPublicContentRoute"), "middleware deve classificar conteúdo público antes da sessão");
  assert.ok(middlewareSource.includes("shouldSendHsts"), "middleware mantém wrapper HSTS para conteúdo público");
  assert.ok(!middlewareSource.includes('startsWith("/api")'), "sem bypass genérico /api/* no middleware");
  assert.ok(!sessionSource.includes('startsWith("/api")'), "sem bypass genérico /api/* na sessão");

  // Allowlists existentes intactas: conteúdo público é lista separada.
  assert.deepEqual(
    [...MACHINE_TO_MACHINE_PATHS].sort(),
    ["/api/csp-report", "/api/webhooks/mercadopago", "/api/webhooks/mercadopago/ipn"].sort(),
    "allowlist M2M exata, sem ampliação",
  );
  assert.deepEqual([...PUBLIC_SEO_PATHS], ["/sitemap.xml"], "allowlist SEO pública exata: só /sitemap.xml");
  assert.deepEqual(
    [...PUBLIC_CONTENT_PATHS].sort(),
    ["/", "/privacidade", "/suporte", "/termos"].sort(),
    "allowlist de conteúdo público exata: só /, /privacidade, /termos, /suporte",
  );

  for (const path of ["/", "/privacidade", "/termos", "/suporte"]) {
    assert.equal(isPublicContentRoute(path), true, `${path} deve ser conteúdo público`);
    assert.equal(isMachineToMachineRoute(path), false, `${path} não é rota M2M`);
    assert.equal(isPublicSeoRoute(path), false, `${path} não é rota SEO`);
  }
});

test("MAI-160: anônimo acessa conteúdo público SEM getUser e SEM criar client (mesmo sem config)", async () => {
  const publicPaths = ["/", "/privacidade", "/termos", "/suporte"];
  for (const path of publicPaths) {
    resetCounters();
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 200, `Anônimo em ${path} deve chegar ao handler`);
    assert.equal(response.headers.get("location"), null, `${path} NÃO deve redirecionar`);
    assert.equal(globalThis.__getUserCalls, 0, `${path} NÃO deve chamar auth.getUser`);
    assert.equal(globalThis.__clientCalls, 0, `${path} NÃO deve criar client Supabase`);
  }

  // Prova de independência do Auth: funciona mesmo sem config Supabase.
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    for (const path of publicPaths) {
      resetCounters();
      const response = await updateSession(createReq(`http://localhost${path}`));
      assert.equal(response.status, 200, `${path} sem config ainda chega ao handler`);
      assert.equal(globalThis.__getUserCalls, 0, `${path} sem config NÃO deve chamar auth.getUser`);
      assert.equal(globalThis.__clientCalls, 0, `${path} sem config NÃO deve criar client`);
    }
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  }
});

test("MAI-160: autenticado em conteúdo público não regride (200, sem Auth no caminho)", async () => {
  globalThis.__mockUser = { id: "user-123" };
  for (const path of ["/", "/privacidade", "/termos", "/suporte"]) {
    globalThis.__getUserCalls = 0;
    globalThis.__clientCalls = 0;
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 200, `Autenticado em ${path} deve renderizar sem redirect`);
    assert.equal(response.headers.get("location"), null, `${path} NÃO deve redirecionar autenticado`);
    assert.equal(globalThis.__getUserCalls, 0, `${path} autenticado NÃO deve chamar auth.getUser (fast-path)`);
    assert.equal(globalThis.__clientCalls, 0, `${path} autenticado NÃO deve criar client`);
  }
  globalThis.__mockUser = null;
});

test("MAI-160: near-match e rotas privadas continuam passando pelo Auth e protegidas", async () => {
  const nearMatches = [
    "/privacidade/",
    "/privacidade-extra",
    "/privacidade2",
    "/termos/",
    "/termos-extra",
    "/TERMOS",
    "/suporte/",
    "/suporte/foo",
    "/suporte-extra",
    "//suporte",
    "/api/privacidade",
    "/pt/privacidade",
  ];
  for (const path of nearMatches) {
    assert.equal(isPublicContentRoute(path), false, `${path} NÃO deve ser conteúdo público`);
    resetCounters();
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 307, `Rota ${path} deve redirecionar para login`);
    assert.match(
      response.headers.get("location") || "",
      new RegExp(`^http://localhost/login/?\\?next=${encodeURIComponent(path)}`),
      `Rota ${path} deve redirecionar para /login com param next`,
    );
    assert.ok(globalThis.__getUserCalls >= 1, `Rota ${path} deve consultar auth.getUser`);
    assert.ok(globalThis.__clientCalls >= 1, `Rota ${path} deve criar client Supabase`);
  }

  const privatePaths = [
    "/dashboard",
    "/calendario",
    "/pagamentos",
    "/perfil",
    "/historico",
    "/api/mercadopago/checkout",
    "/api/mercadopago/verify",
    "/api/mercadopago/sync",
  ];
  for (const path of privatePaths) {
    assert.equal(isPublicContentRoute(path), false, `${path} NÃO deve ser conteúdo público`);
    resetCounters();
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 307, `Rota privada ${path} deve continuar exigindo sessão`);
    assert.ok(globalThis.__getUserCalls >= 1, `Rota privada ${path} deve consultar auth.getUser`);
  }
});

test("MAI-160: fluxos de login/cadastro/recovery preservados (ainda passam pela sessão)", async () => {
  // Anônimo em páginas de entrada: 200 COM getUser (não é fast-path sem Auth).
  for (const path of ["/login", "/cadastro", "/esqueci-senha"]) {
    assert.equal(isPublicContentRoute(path), false, `${path} NÃO deve entrar no fast-path de conteúdo`);
    resetCounters();
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 200, `Anônimo em ${path} deve renderizar`);
    assert.ok(globalThis.__getUserCalls >= 1, `${path} anônimo ainda passa pela sessão`);
  }

  // Autenticado em páginas de entrada: redirect para /dashboard.
  globalThis.__mockUser = { id: "user-123" };
  for (const path of ["/login", "/cadastro", "/esqueci-senha"]) {
    globalThis.__getUserCalls = 0;
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 307, `Autenticado em ${path} deve redirecionar`);
    assert.equal(response.headers.get("location"), "http://localhost/dashboard");
  }
  globalThis.__mockUser = null;

  // Recovery e callback continuam via sessão (não são fast-path sem Auth).
  assert.equal(isPublicContentRoute("/redefinir-senha"), false);
  assert.equal(isPublicContentRoute("/auth/callback"), false);
  resetCounters();
  const reset = await updateSession(createReq("http://localhost/redefinir-senha"));
  assert.equal(reset.status, 200);
  assert.ok(globalThis.__getUserCalls >= 1, "/redefinir-senha passa pela sessão (não é fast-path)");
  resetCounters();
  const callback = await updateSession(createReq("http://localhost/auth/callback?code=test"));
  assert.equal(callback.status, 200);
  assert.ok(globalThis.__getUserCalls >= 1, "/auth/callback passa pela sessão (não é fast-path)");
});
