import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
    if (specifier === "@/lib/observability") {
      const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "observability", "index.ts");
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const rel = specifier.slice(2);
      const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", rel.endsWith(".ts") ? rel : `${rel}.ts`);
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if (specifier.startsWith("./") && context.parentURL && context.parentURL.includes("observability")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.join(parentDir, specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL && !/\.(?:ts|tsx|js|mjs|json)$/.test(specifier)) {
      const resolved = new URL(specifier, context.parentURL);
      const typescriptModule = new URL(`${resolved.href}.ts`);
      if (existsSync(typescriptModule)) return nextResolve(typescriptModule.href, context);
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
  sanitizeStringValue,
  sanitizeSentryEvent,
  createSanitizedException,
  setLogSinkForTesting,
  setSentryHookForTesting,
  webhookTracker,
} = await import("../src/lib/observability/index.ts");

describe("Camada de Observabilidade e Monitoramento de Erros Críticos", () => {
  let capturedLogs = [];
  let capturedSentryExceptions = [];

  beforeEach(() => {
    capturedLogs = [];
    capturedSentryExceptions = [];
    webhookTracker.reset();
    setLogSinkForTesting((log) => {
      capturedLogs.push(log);
    });
    setSentryHookForTesting((exception, hint) => {
      capturedSentryExceptions.push({ exception, hint });
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

  test("2. Sanitização estrita: remoção de tokens, service_role, senhas e cookies em objetos", () => {
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

  test("3. Segurança: Error com Authorization: Bearer SECRET não vaza no log nem no Sentry", () => {
    const secret = "SUPER_SECRET_BEARER_TOKEN_998877";
    const rawError = new Error(`Request failed with Authorization: Bearer ${secret} in header`);

    captureError(rawError, {
      route: "/api/mercadopago/checkout",
      httpStatus: 500,
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.ok(!log.message.includes(secret), "O log estruturado não pode conter o token secreto");
    assert.ok(log.message.includes("Bearer [REDACTED]"));

    assert.equal(capturedSentryExceptions.length, 1);
    const sentryErr = capturedSentryExceptions[0].exception;
    assert.ok(sentryErr instanceof Error);
    assert.ok(!sentryErr.message.includes(secret), "O erro enviado ao Sentry não pode conter o token secreto");
    assert.ok(sentryErr.message.includes("Bearer [REDACTED]"));
  });

  test("4. Segurança: Error com service_role=SECRET não vaza no log nem no Sentry", () => {
    const secret = "SUPABASE_SUPER_SECRET_ROLE_KEY_XYZ";
    const rawError = new Error(`Supabase query rejected for service_role=${secret}`);

    captureError(rawError, {
      rpcName: "save_shift_with_obligation",
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.ok(!log.message.includes(secret), "O log estruturado não pode conter o segredo service_role");
    assert.ok(log.message.includes("service_role=[REDACTED]"));

    assert.equal(capturedSentryExceptions.length, 1);
    const sentryErr = capturedSentryExceptions[0].exception;
    assert.ok(!sentryErr.message.includes(secret), "O erro enviado ao Sentry não pode conter o segredo service_role");
    assert.ok(sentryErr.message.includes("service_role=[REDACTED]"));
  });

  test("5. Segurança: DATABASE_URL com senha não vaza no log nem no Sentry", () => {
    const password = "my_extremely_confidential_postgres_password!456";
    const rawError = new Error(
      `Failed to connect to postgresql://postgres.rwatwitbqcjpmjmqtzxi:${password}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`
    );

    captureError(rawError, {
      route: "/api/webhooks/mercadopago",
    });

    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.ok(!log.message.includes(password), "O log estruturado não pode conter a senha da DATABASE_URL");
    assert.ok(log.message.includes("[REDACTED_PASSWORD]"));

    assert.equal(capturedSentryExceptions.length, 1);
    const sentryErr = capturedSentryExceptions[0].exception;
    assert.ok(!sentryErr.message.includes(password), "O erro enviado ao Sentry não pode conter a senha da DATABASE_URL");
    assert.ok(sentryErr.message.includes("[REDACTED_PASSWORD]"));
  });

  test("6. Hook beforeSend do Sentry sanitiza headers, request body, extras, breadcrumbs e exceções", () => {
    const sensitiveEvent = {
      request: {
        headers: {
          authorization: "Bearer TOP_SECRET_AUTH_HEADER_VAL",
          cookie: "sb-refresh-token=SECRET_COOKIE",
          "x-custom-header": "SafeValue",
        },
        data: '{"database_url":"postgresql://postgres:secretDbPass@db.test.co:5432/postgres"}',
      },
      extra: {
        api_secret: "SECRET_EXTRA_KEY_999",
        safeExtra: "ok",
      },
      breadcrumbs: [
        {
          message: "Request executed with Authorization: Bearer SECRET_BREADCRUMB_TOKEN",
          data: { token: "SECRET_INSIDE_BREADCRUMB" },
        },
      ],
      exception: {
        values: [
          {
            value: "Unhandled error with service_role=SECRET_EXCEPTION_VALUE",
          },
        ],
      },
      message: "Event message with password=SECRET_MSG_PASS",
    };

    const sanitizedEvent = sanitizeSentryEvent(sensitiveEvent);

    // Headers
    assert.equal(sanitizedEvent.request.headers.authorization, "[REDACTED]");
    assert.equal(sanitizedEvent.request.headers.cookie, "[REDACTED]");
    assert.equal(sanitizedEvent.request.headers["x-custom-header"], "SafeValue");

    // Request data
    assert.ok(!sanitizedEvent.request.data.includes("secretDbPass"));
    assert.ok(sanitizedEvent.request.data.includes("[REDACTED_PASSWORD]"));

    // Extras
    assert.equal(sanitizedEvent.extra.api_secret, "[REDACTED]");
    assert.equal(sanitizedEvent.extra.safeExtra, "ok");

    // Breadcrumbs
    assert.ok(!sanitizedEvent.breadcrumbs[0].message.includes("SECRET_BREADCRUMB_TOKEN"));
    assert.ok(sanitizedEvent.breadcrumbs[0].message.includes("Bearer [REDACTED]"));
    assert.equal(sanitizedEvent.breadcrumbs[0].data.token, "[REDACTED]");

    // Exception values
    assert.ok(!sanitizedEvent.exception.values[0].value.includes("SECRET_EXCEPTION_VALUE"));
    assert.ok(sanitizedEvent.exception.values[0].value.includes("service_role=[REDACTED]"));

    // Event message
    assert.ok(!sanitizedEvent.message.includes("SECRET_MSG_PASS"));
    assert.ok(sanitizedEvent.message.includes("password=[REDACTED]"));
  });

  test("7. Sanitização de paymentId seguro", () => {
    assert.equal(sanitizePaymentId("1234567890"), "1234567890");
    assert.equal(sanitizePaymentId("pay_abc-123_xyz"), "pay_abc-123_xyz");
    assert.equal(sanitizePaymentId("pay\nDROP TABLE--"), "[SANITIZED_ID]");
    assert.equal(sanitizePaymentId(undefined), undefined);
  });

  test("8. Alerta checkout_5xx", () => {
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

  test("9. Alerta sync_5xx (default 500 e suporte a override 502)", () => {
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

    // Testa override para 502
    captureSyncError(new Error("Mercado Pago upstream error 502"), {
      userId: "user-sync-1",
      httpStatus: 502,
    });
    assert.equal(capturedLogs.length, 2);
    assert.equal(capturedLogs[1].http_status, 502);
    assert.equal(capturedLogs[1].alert_rule, "sync_5xx");
  });

  test("10. Alerta financial_rpc_error para RPCs críticas", () => {
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

  test("11. Webhook: despacha route para agregação global no Sentry e mantém tracker local como auxiliar", () => {
    // 1ª falha na instância local
    captureWebhookError(new Error("Timeout 1"), { paymentId: "pay-1" });
    assert.equal(capturedLogs[0].alert_rule, undefined);
    assert.equal(capturedLogs[0].level, "error");
    assert.equal(capturedLogs[0].route, "/api/webhooks/mercadopago");
    assert.equal(capturedLogs[0].context?.local_instance_failure_count, 1);

    // 2ª falha na instância local
    captureWebhookError(new Error("Timeout 2"), { paymentId: "pay-2" });
    assert.equal(capturedLogs[1].alert_rule, undefined);
    assert.equal(capturedLogs[1].context?.local_instance_failure_count, 2);

    // 3ª falha consecutiva na mesma instância: dispara alerta auxiliar local
    captureWebhookError(new Error("Timeout 3"), { paymentId: "pay-3" });
    assert.equal(capturedLogs[2].alert_rule, "webhook_repeated_failure");
    assert.equal(capturedLogs[2].level, "fatal");
    assert.equal(capturedLogs[2].context?.local_instance_failure_count, 3);
  });

  test("12. Fail-safe: falha no sink ou Sentry não propaga erro para o chamador", () => {
    setLogSinkForTesting(() => {
      throw new Error("Broken logging infrastructure");
    });
    setSentryHookForTesting(() => {
      throw new Error("Broken Sentry connection");
    });

    assert.doesNotThrow(() => {
      captureError(new Error("Original business error"), { route: "/api/test" });
    });
  });

  test("13. Erro na RPC de pagamentos: lanca erro generico, nao emite console.error com objeto bruto e mascara segredos", async () => {
    const secretKey = "SECRET_SUPER_TOKEN_IN_ERROR_MESSAGE";
    const rpcError = {
      message: `Database connection error: Authorization: Bearer ${secretKey}`,
      code: "23505",
    };

    let rawConsoleErrorEmitted = false;
    const originalConsoleError = console.error;
    console.error = (...args) => {
      for (const arg of args) {
        if (arg === rpcError) {
          rawConsoleErrorEmitted = true;
        }
        const str = typeof arg === "string" ? arg : JSON.stringify(arg);
        assert.ok(!str?.includes(secretKey), "console.error não pode conter o segredo");
      }
    };

    const fakeAdmin = {
      rpc: async () => ({ data: null, error: rpcError }),
    };

    const { processMercadoPagoPayment } = await import("../src/lib/mercadopago/payments.ts");

    try {
      await assert.rejects(
        async () => {
          await processMercadoPagoPayment(fakeAdmin, {
            paymentId: "pay-test-1",
            userId: "11111111-1111-4111-8111-111111111111",
            checkoutId: "00000000-0000-4000-8000-000000000001",
          });
        },
        (err) => {
          assert.equal(err.message, "Falha no processamento atomico do pagamento");
          assert.ok(!err.message.includes(secretKey));
          return true;
        }
      );
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(rawConsoleErrorEmitted, false, "Nenhum console.error com objeto bruto pode ser emitido na RPC");

    // Comprova que captureFinancialRpcError foi acionado
    assert.equal(capturedLogs.length, 1);
    const log = capturedLogs[0];
    assert.equal(log.alert_rule, "financial_rpc_error");
    assert.equal(log.rpc_name, "process_mercadopago_subscription_payment");
    assert.ok(!log.message.includes(secretKey));
    assert.ok(log.message.includes("Bearer [REDACTED]"));
  });

  test("14. Segredo presente em Error.message nao aparece no log, no Sentry nem no erro propagado", () => {
    const leakedPassword = "my_leaked_database_password_987!";
    const errorWithSecret = new Error(`Connection timeout: postgresql://postgres:${leakedPassword}@localhost:5432/db`);

    const logEntry = captureError(errorWithSecret, { route: "/api/test" });
    assert.ok(!logEntry.message.includes(leakedPassword));
    assert.ok(logEntry.message.includes("[REDACTED_PASSWORD]"));

    assert.equal(capturedSentryExceptions.length, 1);
    const sentryException = capturedSentryExceptions[0].exception;
    assert.ok(!sentryException.message.includes(leakedPassword));
    assert.ok(sentryException.message.includes("[REDACTED_PASSWORD]"));
  });

  test("15. IPN e URLs com segredos: sanitização de query parameters, tokens, secrets e dados sensíveis de pagamento", () => {
    // 1. Sanitização de URLs com parâmetros de busca
    const urlWithSecrets = "Failed request to https://api.mercadopago.com/v1/payments/999?access_token=APP_USR-SECRET-123&secret=TOP_SECRET_456&token=MY_TOKEN_789&valid=true";
    const sanitizedUrl = sanitizeStringValue(urlWithSecrets);
    assert.ok(!sanitizedUrl.includes("APP_USR-SECRET-123"));
    assert.ok(!sanitizedUrl.includes("TOP_SECRET_456"));
    assert.ok(!sanitizedUrl.includes("MY_TOKEN_789"));
    assert.ok(sanitizedUrl.includes("access_token=[REDACTED]"));
    assert.ok(sanitizedUrl.includes("secret=[REDACTED]"));
    assert.ok(sanitizedUrl.includes("token=[REDACTED]"));
    assert.ok(sanitizedUrl.includes("&valid=true"));

    // 2. Sanitização de payload de pagamento sensível
    const sensitivePaymentPayload = {
      id: "pay-123",
      payer: {
        email: "sensivel@example.com",
        identification: { number: "12345678900" },
      },
      card: {
        last_four_digits: "1234",
      },
      cvv: "999",
      transaction_amount: 100,
      metadata: {
        months: 1,
      },
    };
    const sanitizedPayload = sanitizeObject(sensitivePaymentPayload);
    assert.equal(sanitizedPayload.id, "pay-123");
    assert.equal(sanitizedPayload.payer, "[REDACTED]");
    assert.equal(sanitizedPayload.card, "[REDACTED]");
    assert.equal(sanitizedPayload.cvv, "[REDACTED]");
    assert.equal(sanitizedPayload.transaction_amount, 100);

    // 3. captureWebhookError com rota /api/webhooks/mercadopago/ipn
    const ipnErr = new Error("IPN upstream failed with Authorization: Bearer SECRET_IPN_TOKEN");
    const log = captureWebhookError(ipnErr, {
      route: "/api/webhooks/mercadopago/ipn",
      paymentId: "ipn-pay-999",
      httpStatus: 502,
    });

    assert.equal(log.route, "/api/webhooks/mercadopago/ipn");
    assert.equal(log.http_status, 502);
    assert.equal(log.payment_id, "ipn-pay-999");
    assert.ok(!log.message.includes("SECRET_IPN_TOKEN"));
    assert.ok(log.message.includes("Bearer [REDACTED]"));

    // Sentry hook recebeu erro sanitizado
    assert.equal(capturedSentryExceptions.length, 1);
    const sentryErr = capturedSentryExceptions[0].exception;
    assert.ok(!sentryErr.message.includes("SECRET_IPN_TOKEN"));
    assert.ok(sentryErr.message.includes("Bearer [REDACTED]"));
    assert.equal(capturedSentryExceptions[0].hint.tags.route, "/api/webhooks/mercadopago/ipn");
  });
});

