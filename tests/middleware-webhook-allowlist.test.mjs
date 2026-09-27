import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return {
        url: "data:text/javascript,export const createServerClient = () => ({ auth: { getUser: async () => ({ data: { user: globalThis.__mockUser || null }, error: null }) } });",
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

function createReq(url, method = "GET") {
  return new NextRequest(url, { method });
}

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
