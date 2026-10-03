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
const { isMachineToMachineRoute, isPublicSeoRoute, MACHINE_TO_MACHINE_PATHS, PUBLIC_SEO_PATHS, updateSession } = await import("../src/lib/auth/session.ts");

function createReq(url, method = "GET") {
  return new NextRequest(url, { method });
}

test("MAI-155: GET /sitemap.xml anônimo chega ao handler SEM sessão e SEM 307/308", async () => {
  const { readFileSync } = await import("node:fs");
  const sessionSource = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
  const seoIndex = sessionSource.indexOf("isPublicSeoRoute(pathname)");
  const getUserIndex = sessionSource.indexOf("supabase.auth.getUser");
  assert.ok(seoIndex !== -1, "updateSession deve classificar SEO público via isPublicSeoRoute");
  assert.ok(getUserIndex !== -1, "updateSession ainda autentica rotas com sessão");
  assert.ok(seoIndex < getUserIndex, "classificação SEO pública deve vir ANTES de auth.getUser");

  const middlewareSource = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.ok(middlewareSource.includes("isPublicSeoRoute"), "middleware deve classificar rota SEO pública antes da sessão");
  assert.ok(middlewareSource.includes("shouldSendHsts"), "middleware mantém wrapper HSTS para a rota pública");
  assert.ok(!middlewareSource.includes('startsWith("/api")'), "sem bypass genérico /api/* no middleware");
  assert.ok(!sessionSource.includes('startsWith("/api")'), "sem bypass genérico /api/* na sessão");

  // Allowlist M2M da MAI-151 intacta: /sitemap.xml NÃO entra na lista M2M.
  assert.deepEqual(
    [...MACHINE_TO_MACHINE_PATHS].sort(),
    ["/api/csp-report", "/api/webhooks/mercadopago", "/api/webhooks/mercadopago/ipn"].sort(),
    "allowlist M2M exata, sem ampliação",
  );
  assert.deepEqual([...PUBLIC_SEO_PATHS], ["/sitemap.xml"], "allowlist SEO pública exata: só /sitemap.xml");
  assert.equal(isPublicSeoRoute("/sitemap.xml"), true);
  assert.equal(isMachineToMachineRoute("/sitemap.xml"), false, "/sitemap.xml não é rota M2M");

  // Anônimo: sem getUser, sem redirect — mesmo sem config Supabase.
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    globalThis.__mockUser = null;
    globalThis.__getUserCalls = 0;
    const response = await updateSession(createReq("http://localhost/sitemap.xml", "GET"));
    assert.equal(response.status, 200, "GET /sitemap.xml anônimo deve chegar ao handler");
    assert.equal(response.headers.get("location"), null, "GET /sitemap.xml NÃO deve redirecionar (307/308)");
    assert.equal(globalThis.__getUserCalls, 0, "GET /sitemap.xml NÃO deve chamar auth.getUser");
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  }
});

test("MAI-155: só a rota exata /sitemap.xml é pública; vizinhas e privadas continuam protegidas", async () => {
  globalThis.__mockUser = null;

  const lookalikes = [
    "/sitemap",
    "/sitemap.xml/",
    "/sitemap.xmlfake",
    "/sitemap.xml.bak",
    "/api/sitemap.xml",
  ];
  for (const path of lookalikes) {
    globalThis.__getUserCalls = 0;
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 307, `Rota ${path} deve redirecionar com status 307`);
    assert.match(
      response.headers.get("location") || "",
      new RegExp(`^http://localhost/login/?\\?next=${encodeURIComponent(path)}`),
      `Rota ${path} deve redirecionar para /login com param next`,
    );
  }
  assert.equal(isPublicSeoRoute("/sitemap"), false);
  assert.equal(isPublicSeoRoute("/sitemap.xml/"), false);

  const privatePaths = [
    "/dashboard",
    "/pagamentos",
    "/api/mercadopago/checkout",
    "/api/mercadopago/verify",
    "/auth/callback",
  ];
  for (const path of privatePaths.filter((p) => p !== "/auth/callback")) {
    const response = await updateSession(createReq(`http://localhost${path}`));
    assert.equal(response.status, 307, `Rota privada ${path} deve continuar exigindo sessão`);
  }
  // /auth/callback é pública por sessão (fluxo OAuth), mas exige getUser — não é fast-path sem Auth.
  globalThis.__getUserCalls = 0;
  const callback = await updateSession(createReq("http://localhost/auth/callback?code=test"));
  assert.equal(callback.status, 200);
  assert.ok(globalThis.__getUserCalls >= 1, "/auth/callback passa pela sessão (não é fast-path)");
});

test("MAI-155: sitemap contém as 3 URLs canônicas e robots aponta para o sitemap", async () => {
  const sitemapModule = await import("../src/app/sitemap.ts");
  const entries = sitemapModule.default();
  assert.equal(entries.length, 3, "sitemap deve conter exatamente 3 URLs públicas");
  const urls = entries.map((e) => e.url);
  const base = urls[0].replace(/\/$/, "");
  assert.ok(urls.includes(base), "deve incluir a raiz");
  assert.ok(urls.includes(`${base}/privacidade`), "deve incluir /privacidade");
  assert.ok(urls.includes(`${base}/termos`), "deve incluir /termos");

  const robotsModule = await import("../src/app/robots.ts");
  const config = robotsModule.default();
  assert.ok(config.sitemap.endsWith("/sitemap.xml"), "robots deve apontar para /sitemap.xml");
  assert.equal(config.sitemap, `${base}/sitemap.xml`, "robots.sitemap usa a origem canônica (sem domínio hardcodado)");
});
