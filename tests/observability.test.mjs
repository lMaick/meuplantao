import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test, { describe, beforeEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") {
      return {
        url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("./") && context.parentURL && context.parentURL.includes("observability")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.join(parentDir, specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  captureError,
  captureCheckoutError,
  captureSyncError,
  captureWebhookError,
  captureFinancialRpcError,
  sanitizeObject,
  sanitizePaymentId,
  setLogSinkForTesting,
  webhookTracker,
} = await import("../src/lib/observability/index.ts");

describe("Camada de Observabilidade e Monitoramento de Erros Críticos", () => {
  let capturedLogs = [];

  beforeEach(() => {
    capturedLogs = [];
    webhookTracker.reset();
    setLogSinkForTesting((log) => {
      capturedLogs.push(log);
    });
  });

  test("1. Captura de erro com metadados estruturados obrigatórios", () => {
    const error = new Error("Database timeout connection");
    captureError(error, {
      route: "/api/test/route",
      httpStatus: 503,
      userId: "user-123",
      extra: { testParam: "value" },
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];

    assert.equal(log.message, "Database timeout connection");
    assert.equal(log.error_type, "Error");
    assert.equal(log.route, "/api/test/route");
    assert.equal(log.http_status, 503);
    assert.ok(log.timestamp);
    assert.ok(!isNaN(Date.parse(log.timestamp)));
    assert.ok(log.environment);
    assert.ok(log.release);
    assert.equal(log.level, "error");
    assert.deepEqual(log.context, { testParam: "value" });
  });

  test("2. Sanitização estrita: remoção de tokens, service_role, senhas e cookies", () => {
    const sensitivePayload = {
      user_id: "safe-user-id",
      access_token: "sbp_abcdef1234567890",
      password: "secretpassword123",
      service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake_signature_part",
      cookie: "sb-auth-token=xyz",
      nested: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token.sig",
        card_number: "4111222233334444",
        cvv: "123",
        safeNote: "Clinica Salvador",
      },
    };

    const sanitized = sanitizeObject(sensitivePayload);

    assert.equal(sanitized.user_id, "safe-user-id");
    assert.equal(sanitized.access_token, "[REDACTED]");
    assert.equal(sanitized.password, "[REDACTED]");
    assert.equal(sanitized.service_role_key, "[REDACTED]");
    assert.equal(sanitized.cookie, "[REDACTED]");
    assert.equal(sanitized.nested.authorization, "[REDACTED]");
    assert.equal(sanitized.nested.card_number, "[REDACTED]");
    assert.equal(sanitized.nested.cvv, "[REDACTED]");
    assert.equal(sanitized.nested.safeNote, "Clinica Salvador");
  });

  test("3. Sanitização de paymentId seguro", () => {
    assert.equal(sanitizePaymentId("1234567890"), "1234567890");
    assert.equal(sanitizePaymentId("pay_abc-123_xyz"), "pay_abc-123_xyz");
    assert.equal(sanitizePaymentId("pay\nDROP TABLE--"), "[SANITIZED_ID]");
    assert.equal(sanitizePaymentId(undefined), undefined);
  });

  test("4. Alerta checkout_5xx", () => {
    const error = new Error("Mercado Pago preference generation failed");
    captureCheckoutError(error, {
      userId: "user-checkout-1",
      extra: { months: 3 },
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.equal(log.route, "/api/mercadopago/checkout");
    assert.equal(log.http_status, 500);
    assert.equal(log.alert_rule, "checkout_5xx");
    assert.equal(log.level, "error");
  });

  test("5. Alerta sync_5xx", () => {
    const error = new Error("Mercado Pago sync search failed with 500");
    captureSyncError(error, {
      userId: "user-sync-1",
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.equal(log.route, "/api/mercadopago/sync");
    assert.equal(log.http_status, 500);
    assert.equal(log.alert_rule, "sync_5xx");
    assert.equal(log.level, "error");
  });

  test("6. Alerta financial_rpc_error para RPCs críticas", () => {
    const error = new Error("Unique constraint violation on obligation");
    captureFinancialRpcError(error, {
      rpcName: "save_shift_with_obligation",
      userId: "user-doctor-1",
      extra: { shift_id: "shift-99" },
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.equal(log.rpc_name, "save_shift_with_obligation");
    assert.equal(log.alert_rule, "financial_rpc_error");
    assert.equal(log.level, "fatal");
  });

  test("7. Alerta webhook_repeated_failure acionado após limiar de falhas", () => {
    // 1ª falha: normal
    captureWebhookError(new Error("Timeout 1"), { paymentId: "pay-1" });
    assert.equal(capturedLogs[0].alert_rule, undefined);
    assert.equal(capturedLogs[0].level, "error");

    // 2ª falha: normal
    captureWebhookError(new Error("Timeout 2"), { paymentId: "pay-2" });
    assert.equal(capturedLogs[1].alert_rule, undefined);

    // 3ª falha consecutiva: deve disparar o alerta webhook_repeated_failure e nível fatal
    captureWebhookError(new Error("Timeout 3"), { paymentId: "pay-3" });
    assert.equal(capturedLogs[2].alert_rule, "webhook_repeated_failure");
    assert.equal(capturedLogs[2].level, "fatal");
  });

  test("8. Fail-safe: falha no sink ou Sentry não propaga erro para o chamador", () => {
    setLogSinkForTesting(() => {
      throw new Error("Broken logging infrastructure");
    });

    assert.doesNotThrow(() => {
      captureError(new Error("Original business error"), { route: "/api/test" });
    });
  });
});
