import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paymentsUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "payments.ts")).href;
const observabilityUrl = pathToFileURL(path.join(ROOT, "src", "lib", "observability", "index.ts")).href;
const configUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "config.ts")).href;
const httpUrl = pathToFileURL(path.join(ROOT, "src", "lib", "mercadopago", "http.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    }
    if (specifier === "@/lib/observability") return { url: observabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/payments") return { url: paymentsUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/config") return { url: configUrl, shortCircuit: true };
    if (specifier === "@/lib/mercadopago/http") return { url: httpUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// MAI-147 auditoria: bypass da cotacao na RPC.
// A concessao de vigencia NUNCA pode ocorrer sem consumir uma cotacao.

test("MAI-147 fail-closed: migration 29400000 remove overload de 6 args e exige cotacao", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260929400000_subscription_checkout_required_failclosed.sql"),
    "utf-8",
  );
  assert.match(
    sql,
    /drop function if exists public\.process_mercadopago_subscription_payment\(text, uuid, integer, integer, numeric, text\)/i,
    "migration deve remover a sobrecarga legada de 6 argumentos",
  );
  assert.match(
    sql,
    /drop function if exists public\.process_mercadopago_subscription_payment\(text, uuid, integer, integer, numeric, text, uuid\)/i,
    "migration deve dropar a assinatura de 7 args com DEFAULT (SQLSTATE 42P13: CREATE OR REPLACE nao pode remover parameter defaults)",
  );
  // Ordem fail-closed: ambos os DROPs antes do CREATE OR REPLACE.
  const drop7 = sql.search(/drop function if exists public\.process_mercadopago_subscription_payment\(text, uuid, integer, integer, numeric, text, uuid\)/i);
  const createFn = sql.search(/create or replace function public\.process_mercadopago_subscription_payment\(/i);
  assert.ok(drop7 !== -1 && createFn !== -1 && drop7 < createFn, "DROP da assinatura de 7 args deve preceder o CREATE OR REPLACE");
  assert.match(
    sql,
    /p_checkout_id uuid\s*\)/i,
    "assinatura de 7 args deve declarar p_checkout_id sem DEFAULT (obrigatorio)",
  );
  assert.ok(
    !/p_checkout_id uuid default null/i.test(sql),
    "p_checkout_id nao pode ter DEFAULT NULL (bypass)",
  );
  assert.match(
    sql,
    /Cotacao de checkout obrigatoria/,
    "migration deve rejeitar p_checkout_id nulo com erro fail-closed",
  );
  assert.match(
    sql,
    /revoke execute on function public\.process_mercadopago_subscription_payment\(text, uuid, integer, integer, numeric, text, uuid\)/i,
    "migration deve revogar a assinatura de 7 args (a de 6 args foi dropada — REVOKE nela falharia)",
  );
});

test("MAI-147 fail-closed: processMercadoPagoPayment exige checkoutId antes da RPC", async () => {
  const { processMercadoPagoPayment } = await import("../src/lib/mercadopago/payments.ts");
  let rpcCalled = false;
  const fakeAdmin = {
    rpc: async () => {
      rpcCalled = true;
      return { data: null, error: null };
    },
  };

  await assert.rejects(
    () => processMercadoPagoPayment(fakeAdmin, {
      paymentId: "pay-no-quote",
      userId: "11111111-1111-4111-8111-111111111111",
    }),
    /Cotacao de checkout obrigatoria/,
    "sem checkoutId deve falhar antes de chamar a RPC",
  );
  assert.equal(rpcCalled, false, "RPC nao pode ser chamada sem cotacao");

  rpcCalled = false;
  await assert.rejects(
    () => processMercadoPagoPayment(fakeAdmin, {
      paymentId: "pay-no-quote",
      userId: "11111111-1111-4111-8111-111111111111",
      checkoutId: "   ",
    }),
    /Cotacao de checkout obrigatoria/,
  );
  assert.equal(rpcCalled, false);
});

test("MAI-147 fail-closed: processMercadoPagoPayment sempre envia p_checkout_id a RPC", async () => {
  const { processMercadoPagoPayment } = await import("../src/lib/mercadopago/payments.ts");
  let captured = null;
  const fakeAdmin = {
    rpc: async (fn, params) => {
      captured = { fn, params };
      return {
        data: {
          already_processed: false,
          current_period_end: new Date().toISOString(),
          validity_days_added: 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  await processMercadoPagoPayment(fakeAdmin, {
    paymentId: "pay-with-quote",
    userId: "11111111-1111-4111-8111-111111111111",
    months: 1,
    validityDays: 30,
    amount: 12.9,
    status: "approved",
    checkoutId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(captured.fn, "process_mercadopago_subscription_payment");
  assert.equal(captured.params.p_checkout_id, "00000000-0000-4000-8000-000000000001");
});
