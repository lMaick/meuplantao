import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const STUBS = {
  "@supabase/ssr":
    "export const createServerClient = () => ({ auth: { getUser: async () => globalThis.__delTest.getUser() } });",
  "@supabase/supabase-js":
    "export const createClient = () => ({ rpc: async (name, args) => { globalThis.__delTest.rpcCalls.push({ name, args }); return globalThis.__delTest.rpc(); } });",
  "@sentry/nextjs": "export const init = () => {}; export const captureException = () => {};",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      return nextResolve(fs.existsSync(new URL(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`, context);
    }
    if (/^\.\.?\//.test(specifier) && context.parentURL && !/\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
      const resolved = new URL(`${new URL(specifier, context.parentURL).href}.ts`);
      if (fs.existsSync(resolved)) return nextResolve(resolved.href, context);
    }
    return nextResolve(specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const { NextRequest } = await import("next/server.js");
const { POST } = await import("../src/app/api/account/delete/route.ts");
const { isDeleteConfirmation } = await import("../src/lib/account/delete-account.ts");
const { reconcileMercadoPagoReversal } = await import("../src/lib/mercadopago/reversals.ts");
const { quarantinePayment } = await import("../src/lib/mercadopago/payments.ts");

const USER = "00000000-0000-0000-0000-0000000000a1";

function request({ body = { confirmacao: "EXCLUIR" }, headers = {} } = {}) {
  return new NextRequest("https://meuplantao.pro/api/account/delete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      cookie: "sb-proj-auth-token.0=a; sb-proj-auth-token.1=b; tema=escuro",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  globalThis.__delTest = {
    rpcCalls: [],
    getUser: () => ({ data: { user: { id: USER } }, error: null }),
    rpc: () => ({ data: { deleted: true, receipts: 0 }, error: null }),
  };
});

describe("POST /api/account/delete", () => {
  test("apaga só a conta da sessão e limpa os cookies de login", async () => {
    const res = await POST(request({ body: { confirmacao: " excluir ", userId: "outra-pessoa", p_user_id: "outra-pessoa" } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(globalThis.__delTest.rpcCalls, [{ name: "delete_account", args: { p_user_id: USER } }]);
    const cookies = res.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every((c) => c.startsWith("sb-") && /Max-Age=0/i.test(c)));
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("sem a palavra de confirmação, nada é apagado", async () => {
    for (const body of [{}, { confirmacao: "" }, { confirmacao: "SIM" }, { confirmacao: true }, "null", "{quebrado"]) {
      const res = await POST(request({ body }));
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.equal(globalThis.__delTest.rpcCalls.length, 0);
    assert.equal(isDeleteConfirmation("EXCLUIR TUDO"), false);
  });

  test("recusa pedido vindo de outro site ou de formulário", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      assert.equal((await POST(request({ headers: { "sec-fetch-site": site } }))).status, 403, site);
    }
    assert.equal((await POST(request({ headers: { "content-type": "text/plain" } }))).status, 415);
    assert.equal(globalThis.__delTest.rpcCalls.length, 0);
  });

  test("sem sessão válida, nada é apagado", async () => {
    globalThis.__delTest.getUser = () => ({ data: { user: null }, error: { message: "expirada" } });
    const res = await POST(request());
    assert.equal(res.status, 401);
    assert.equal(globalThis.__delTest.rpcCalls.length, 0);
  });

  test("falha no banco devolve erro e mantém a pessoa logada", async () => {
    globalThis.__delTest.rpc = () => ({ data: null, error: { code: "23514", message: "detalhe interno" } });
    const res = await POST(request());
    assert.equal(res.status, 500);
    assert.equal(res.headers.getSetCookie().length, 0);
    assert.ok(!(await res.text()).includes("detalhe interno"));
  });
});

describe("Pagamento ou estorno que chega depois da exclusão", () => {
  const fkError = { code: "23503", message: "violates foreign key" };

  test("estorno atualiza só o recibo anônimo e não repete a notificação", async () => {
    const updates = [];
    const admin = {
      rpc: () => Promise.resolve({ data: null, error: fkError }),
      from: (table) => ({
        update: (values) => ({
          eq: async (column, value) => {
            updates.push({ table, values, column, value });
            return { error: null };
          },
        }),
      }),
    };
    const result = await reconcileMercadoPagoReversal(admin, {
      paymentId: "mp-1",
      userId: USER,
      reversalStatus: "refunded",
    });
    assert.equal(result.reversed, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].table, "deleted_account_receipts");
    assert.equal(updates[0].values.status, "refunded");
    assert.deepEqual([updates[0].column, updates[0].value], ["mercadopago_payment_id", "mp-1"]);
  });

  test("outros erros do estorno continuam falhando", async () => {
    const admin = { rpc: () => Promise.resolve({ data: null, error: { code: "57014", message: "timeout" } }) };
    await assert.rejects(
      reconcileMercadoPagoReversal(admin, { paymentId: "mp-1", userId: USER, reversalStatus: "refunded" }),
    );
  });

  test("pagamento tardio fica registrado na quarentena sem titular", async () => {
    const inserts = [];
    const admin = {
      from: () => ({
        insert: async (row) => {
          inserts.push(row);
          return { error: row.user_id ? fkError : null };
        },
      }),
    };
    await quarantinePayment(admin, {
      paymentId: "mp-2",
      userId: USER,
      reason: "quote_not_found",
      amount: 12.9,
      checkoutId: "c1",
      rawPayload: { external_reference: USER },
    });
    assert.equal(inserts.length, 2);
    assert.equal(inserts[1].user_id, null);
    assert.equal(inserts[1].checkout_id, null);
    assert.deepEqual(inserts[1].sanitized_payload, {});
    assert.equal(inserts[1].amount, 12.9);
  });
});

describe("Banco, telas e textos", () => {
  const migration = read("supabase/migrations/20261124160000_account_deletion.sql");

  test("só o servidor executa a exclusão e ninguém lê recibos pelo app", () => {
    assert.match(migration, /revoke execute on function public\.delete_account\(uuid\) from public, anon, authenticated;/);
    assert.match(migration, /grant execute on function public\.delete_account\(uuid\) to service_role;/);
    assert.match(migration, /security definer\nset search_path = ''/);
    assert.match(migration, /alter table public\.deleted_account_receipts enable row level security;/);
    assert.match(migration, /revoke all on public\.deleted_account_receipts from anon, authenticated, service_role, public;/);
    assert.doesNotMatch(migration, /session_replication_role|disable trigger|set_config|drop trigger|drop policy/i);
  });

  test("recibo não tem coluna que identifique a pessoa", () => {
    const table = migration.slice(migration.indexOf("create table"), migration.indexOf(");"));
    assert.doesNotMatch(table, /user_id|email|nome|telefone/);
  });

  test("CI valida a exclusão em banco real", () => {
    assert.match(read(".github/workflows/ci.yml"), /-f tests\/account-deletion-real\.sql/);
  });

  test("caminho no app e link público existem e explicam o que fica", () => {
    assert.match(read("src/app/perfil/page.tsx"), /href="\/excluir-conta"/);
    assert.match(read("src/app/privacidade/page.tsx"), /href="\/excluir-conta"/);
    assert.match(read("src/components/ui/app-shell.tsx"), /"\/excluir-conta"/);
    const page = read("src/app/excluir-conta/page.tsx");
    assert.match(page, /O que é apagado/);
    assert.match(page, /O que é mantido/);
    assert.match(page, /MeuPlantão/);
    assert.match(page, /index: false/);
  });

  test("a tela avisa do Pro ativo e, no app Android, não cita reembolso nem preço", () => {
    const card = read("src/components/account/delete-account-card.tsx");
    assert.match(card, /você perde os dias restantes/);
    assert.match(card, /isTwa\s*\?\s*"Se tiver dúvidas, fale com o suporte antes de excluir\."/);
    assert.doesNotMatch(card, /R\$|Mercado Pago|PIX/i);
    assert.match(card, /min-h-\[44px\]/);
    assert.match(card, /motion-reduce:animate-none/);
  });
});
