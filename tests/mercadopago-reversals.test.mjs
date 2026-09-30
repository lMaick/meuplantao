import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const thisFile = fileURLToPath(import.meta.url);
const reversalsUrl = pathToFileURL(
  path.join(path.dirname(thisFile), "..", "src", "lib", "mercadopago", "reversals.ts"),
).href;
const observabilityUrl = pathToFileURL(
  path.join(path.dirname(thisFile), "..", "src", "lib", "observability", "index.ts"),
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    }
    if (specifier === "@/lib/observability") return { url: observabilityUrl, shortCircuit: true };
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && !/\.(?:ts|tsx|js|mjs|json)$/.test(specifier)) {
      const resolved = new URL(specifier, context.parentURL);
      const typescriptModule = new URL(`${resolved.href}.ts`);
      if (existsSync(typescriptModule)) return nextResolve(typescriptModule.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const reversals = await import(reversalsUrl);
const { isReversalStatus, isDisputeStatus, normalizeProviderStatus, reconcileMercadoPagoReversal } = reversals;

test("classifica estados do provedor: reversao definitiva x disputa x ignorados", () => {
  assert.equal(isReversalStatus("refunded"), true);
  assert.equal(isReversalStatus("charged_back"), true);
  assert.equal(isReversalStatus("REFUNDED"), true);
  assert.equal(isReversalStatus("approved"), false);
  assert.equal(isReversalStatus("pending"), false);
  assert.equal(isReversalStatus("in_mediation"), false);

  assert.equal(isDisputeStatus("in_mediation"), true);
  assert.equal(isDisputeStatus("approved"), false);
  assert.equal(isDisputeStatus("refunded"), false);

  assert.equal(normalizeProviderStatus("  Charged_Back "), "charged_back");
});

test("reconciliacao rejeita status nao-reversivel antes de chamar a RPC", async () => {
  let rpcCalled = false;
  const admin = { rpc: async () => { rpcCalled = true; return { data: {}, error: null }; } };
  await assert.rejects(
    () => reconcileMercadoPagoReversal(admin, { paymentId: "pay-1", userId: "user-1", reversalStatus: "approved" }),
    /reversao invalido/i,
  );
  assert.equal(rpcCalled, false);
});

test("reconciliacao chama a RPC atomica com parametros saneados e retorna o envelope", async () => {
  const calls = [];
  const admin = {
    rpc: async (fn, params) => {
      calls.push({ fn, params });
      return {
        data: {
          reversed: true,
          already_reversed: false,
          not_found: false,
          ownership_mismatch: false,
          contributed: true,
          current_period_end: "2026-11-01T00:00:00.000Z",
          status: "expired",
          active_payments: 0,
          validity_days_removed: 30,
        },
        error: null,
      };
    },
  };

  const result = await reconcileMercadoPagoReversal(admin, {
    paymentId: "  pay-123 ",
    userId: "  user-abc ",
    reversalStatus: "REFUNDED",
    months: 1,
    validityDays: 30,
    amount: "12.90",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "reconcile_mercadopago_reversal");
  assert.equal(calls[0].params.p_payment_id, "pay-123");
  assert.equal(calls[0].params.p_user_id, "user-abc");
  assert.equal(calls[0].params.p_reversal_status, "refunded");
  assert.equal(result.reversed, true);
  assert.equal(result.validity_days_removed, 30);
  assert.equal(result.status, "expired");
});

test("falha da RPC e registrada sem expor segredos e relancada como erro generico", async () => {
  const admin = { rpc: async () => ({ data: null, error: { message: "db down", code: "XX000" } }) };
  await assert.rejects(
    () => reconcileMercadoPagoReversal(admin, { paymentId: "pay-9", userId: "user-9", reversalStatus: "charged_back" }),
    /reconciliacao do estorno/i,
  );
});
