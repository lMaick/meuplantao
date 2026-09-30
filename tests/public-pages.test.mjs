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

test("privacy policy accurately reflects data integrity, technical observability and transparency disclaimer", async () => {
  const { readFileSync } = await import("node:fs");
  const privacyContent = readFileSync(new URL("../src/app/privacidade/page.tsx", import.meta.url), "utf-8");
  const publicPageContent = readFileSync(new URL("../src/components/public-page.tsx", import.meta.url), "utf-8");
  const normalizedPrivacy = privacyContent.replace(/\s+/g, " ");

  // Não deve usar o termo restritivo falso "exclusivamente para"
  assert.ok(!normalizedPrivacy.includes("exclusivamente para"), "Não deve alegar uso exclusivo que oculte tratamento técnico");

  // Tratamento técnico deve estar explícito
  assert.ok(normalizedPrivacy.includes("segurança"), "Deve cobrir finalidade de segurança");
  assert.ok(normalizedPrivacy.includes("diagnóstico de erros"), "Deve cobrir diagnóstico de erros");
  assert.ok(normalizedPrivacy.includes("disponibilidade"), "Deve cobrir disponibilidade");
  assert.ok(normalizedPrivacy.includes("prevenção de abuso"), "Deve cobrir prevenção de abuso");
  assert.ok(normalizedPrivacy.includes("observabilidade"), "Deve cobrir observabilidade");

  // Integridade financeira e exclusão responsável
  assert.ok(
    normalizedPrivacy.includes("conforme a natureza do dado e as regras de integridade aplicáveis, editar, cancelar ou excluir"),
    "Deve ressalvar que edição/exclusão depende da natureza do dado e regras de integridade"
  );
  assert.ok(
    normalizedPrivacy.includes("Solicitações relacionadas à exclusão da conta e dos dados associados podem ser feitas pelo suporte"),
    "Deve indicar que exclusão ampla de conta pode ser solicitada via suporte"
  );
  assert.ok(
    normalizedPrivacy.includes("necessidades legítimas de integridade, segurança e retenção"),
    "Deve ressalvar necessidades legítimas de integridade, segurança e retenção"
  );

  // Aviso de revisão jurídica antes do lançamento comercial
  const normalizedPublicPage = publicPageContent.replace(/\s+/g, " ");
  assert.ok(
    normalizedPublicPage.includes("revisão e validação jurídica formal antes da disponibilização em escala comercial"),
    "Deve manter aviso de transparência sobre validação jurídica pré-lançamento público"
  );
});

