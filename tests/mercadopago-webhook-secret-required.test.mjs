// tests/mercadopago-webhook-secret-required.test.mjs
//
// Issue #113 - security(mercadopago): exigir webhook secret em producao.
//
// Contrato assumido para a slice setup-state implementar na rota/validador:
// - Producao = VERCEL_ENV === "production" ou NODE_ENV === "production".
// - Dev/test SEM secret: permitido por padrao fora de producao; opt-out
//   explicito via MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET=false.
// - Codigo/erro publico: WEBHOOK_NOT_CONFIGURED_CODE com HTTP 503 e
//   WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR (sem detalhes internos).
// - Producao SEM secret: falha fechada. validateWebhookSignature retorna
//   invalido e a rota responde HTTP 503 com erro publico generico, sem
//   detalhes internos, ANTES de qualquer fetch a API do Mercado Pago ou RPC.
// - Dev/test SEM secret: permitido apenas com ambiente nao-producao explicito
//   (NODE_ENV diferente de production); nunca implicito em producao.
// - Secret configurado: x-signature e x-request-id obrigatorios, HMAC
//   verificado, replay protection e idempotencia preservados.
// - IPN legado (/ipn) nao exige x-signature; autentica via consulta com
//   Bearer token a API do Mercado Pago.
//
// Cobertura offline com mocks (fetch/adminClient falsos, segredos ficticios).
// Estes testes NAO provam Supabase/RLS/RPC real, triggers ou concorrencia;
// isso depende de E2E real com Supabase (ver tests/REAL-E2E.md).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __mp113File = fileURLToPath(import.meta.url);
const __mp113TrialUrl = pathToFileURL(path.join(path.dirname(__mp113File), "..", "src", "lib", "subscription", "trial.ts")).href;
const __mp113PaymentsUrl = pathToFileURL(path.join(path.dirname(__mp113File), "..", "src", "lib", "mercadopago", "payments.ts")).href;
const __mp113WebhookUrl = pathToFileURL(path.join(path.dirname(__mp113File), "..", "src", "lib", "mercadopago", "webhook.ts")).href;
const __mp113ObservabilityUrl = pathToFileURL(path.join(path.dirname(__mp113File), "..", "src", "lib", "observability", "index.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@sentry/nextjs") return { url: "data:text/javascript,export const init = () => {}; export const captureException = () => {};", shortCircuit: true };
    if (specifier === "@/lib/observability") return { url: __mp113ObservabilityUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") {
      return { url: __mp113TrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return { url: __mp113PaymentsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/webhook") {
      return { url: __mp113WebhookUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-test-token-113'; export const getMercadoPagoWebhookSecret = () => globalThis.__mockWebhookSecret ?? null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com';",
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/supabase/server" || specifier === "@/lib/stripe/supabase") {
      return {
        url: "data:text/javascript,export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: webhookPost, validateWebhookSignature } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { GET: ipnGet, POST: ipnPost } = await import("../src/app/api/webhooks/mercadopago/ipn/route.ts");
const { WEBHOOK_NOT_CONFIGURED_CODE, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR } = await import("../src/lib/mercadopago/webhook.ts");

delete process.env.VERCEL_ENV;
delete process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET;

const validUserId = "33333333-3333-4333-8333-333333333333";
const fakeSecret = "test-only-webhook-secret-113";

function signWebhook(paymentId, requestId, timestamp, secret) {
  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

function snapshotGlobals() {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    allowFlag: process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET,
    secret: globalThis.__mockWebhookSecret,
    fetch: globalThis.fetch,
    adminClient: globalThis.adminClient,
  };
}

function restoreGlobals(snap) {
  if (snap.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = snap.nodeEnv;
  if (snap.vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = snap.vercelEnv;
  if (snap.allowFlag === undefined) delete process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET;
  else process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET = snap.allowFlag;
  globalThis.__mockWebhookSecret = snap.secret ?? null;
  globalThis.fetch = snap.fetch;
  globalThis.adminClient = snap.adminClient;
}

function approvedPaymentHandler(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({ status: "approved", external_reference: validUserId, transaction_amount: 12.9 }),
      { status: 200 },
    );
  };
}

function countingAdminStub(state) {
  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  return {
    rpc: async (fn) => {
      state.rpcCalls++;
      assert.equal(fn, "process_mercadopago_subscription_payment");
      return {
        data: {
          already_processed: state.rpcCalls > 1,
          current_period_end: futureEnd,
          validity_days_added: state.rpcCalls > 1 ? 0 : 30,
          status: "active",
        },
        error: null,
      };
    },
  };
}

function signedPost({ paymentId, requestId, secret, timestamp = Math.floor(Date.now() / 1000) }) {
  const hash = signWebhook(paymentId, requestId, timestamp, secret);
  return new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${timestamp},v1=${hash}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });
}test("113.1 producao sem secret: validateWebhookSignature rejeita (fail-closed)", () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "test";
    process.env.VERCEL_ENV = "production";
    globalThis.__mockWebhookSecret = null;
    const request = new Request("http://localhost/api/webhooks/mercadopago?type=payment", { method: "POST" });
    const result = validateWebhookSignature(request, "payment-113-1");
    assert.equal(result.valid, false, "producao sem secret deve falhar fechada, nunca aplicar bypass de HMAC");
    assert.equal(result.code, WEBHOOK_NOT_CONFIGURED_CODE);
    assert.equal(result.error, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR);
  } finally {
    restoreGlobals(snap);
  }
});

test("113.2 producao sem secret: POST rejeita com 503 generico antes de fetch/RPC", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = null;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);
    const state = { rpcCalls: 0 };
    globalThis.adminClient = {
      rpc: async () => {
        state.rpcCalls++;
        throw new Error("RPC nao deveria ser chamado sem secret em producao");
      },
    };

    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-113-2" }, type: "payment" }),
    });
    const response = await webhookPost(request);
    assert.equal(response.status, 503, "producao sem secret deve responder 503 (falha de configuracao)");
    const json = await response.json();
    assert.equal(json.error, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR, "resposta publica deve usar o erro generico do contrato");
    assert.ok(json.error.length > 0, "resposta publica deve conter erro generico");
    assert.doesNotMatch(json.error, /secret|MERCADO_PAGO|env|token|stack/i, "resposta publica nao deve vazar detalhes internos");
    assert.notEqual(json.processed, true, "evento nao pode ser processado sem secret em producao");
    assert.equal(fetchCalls.length, 0, "deve rejeitar antes de consultar a API do Mercado Pago");
    assert.equal(state.rpcCalls, 0, "deve rejeitar antes de qualquer RPC Supabase");
  } finally {
    restoreGlobals(snap);
  }
});

test("113.3 producao com secret: assinatura ausente rejeita com 401", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);

    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-113-3" }, type: "payment" }),
    });
    const response = await webhookPost(request);
    assert.equal(response.status, 401);
    const json = await response.json();
    assert.match(json.error, /ausente/i);
    assert.equal(fetchCalls.length, 0, "assinatura ausente nao deve alcancar a API do Mercado Pago");
  } finally {
    restoreGlobals(snap);
  }
});

test("113.4 producao com secret: x-request-id ausente rejeita com 401", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);

    const paymentId = "payment-113-4";
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = signWebhook(paymentId, "req-113-4", timestamp, fakeSecret);
    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": `ts=${timestamp},v1=${hash}`,
      },
      body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
    });
    const response = await webhookPost(request);
    assert.equal(response.status, 401);
    const json = await response.json();
    assert.match(json.error, /x-request-id|identificador da requisicao/i);
    assert.equal(fetchCalls.length, 0, "x-request-id ausente nao deve alcancar a API do Mercado Pago");
  } finally {
    restoreGlobals(snap);
  }
});test("113.5 producao com secret: HMAC invalido rejeita com 401 sem fetch", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);

    const paymentId = "payment-113-5";
    const timestamp = Math.floor(Date.now() / 1000);
    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": `ts=${timestamp},v1=0badc0de0123456789abcdef0123456789abcdef0123456789abcdef00`,
        "x-request-id": "req-113-5",
      },
      body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
    });
    const response = await webhookPost(request);
    assert.equal(response.status, 401);
    const json = await response.json();
    assert.match(json.error, /invalida/i);
    assert.equal(fetchCalls.length, 0, "HMAC invalido nao deve alcancar a API do Mercado Pago");
  } finally {
    restoreGlobals(snap);
  }
});

test("113.6 producao com secret: HMAC valido processa com 200", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);
    const state = { rpcCalls: 0 };
    globalThis.adminClient = countingAdminStub(state);

    const paymentId = "payment-113-6";
    const response = await webhookPost(signedPost({ paymentId, requestId: "req-113-6", secret: fakeSecret }));
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.received, true);
    assert.equal(json.processed, true);
    assert.equal(json.already_processed, false);
    assert.equal(fetchCalls.length, 1);
    assert.equal(state.rpcCalls, 1);
  } finally {
    restoreGlobals(snap);
  }
});

test("113.7 dev/test sem secret: comportamento explicito sem secret processa", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "test";
    globalThis.__mockWebhookSecret = null;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);
    const state = { rpcCalls: 0 };
    globalThis.adminClient = countingAdminStub(state);

    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-113-7" }, type: "payment" }),
    });
    const response = await webhookPost(request);
    assert.equal(response.status, 200, "ambiente nao-producao com NODE_ENV explicito processa sem secret");
    const json = await response.json();
    assert.equal(json.received, true);
    assert.equal(json.processed, true);
  } finally {
    restoreGlobals(snap);
  }
});

test("113.8 IPN legado em producao com secret: GET e POST sem x-signature processam via lookup autenticado", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);
    const state = { rpcCalls: 0 };
    globalThis.adminClient = countingAdminStub(state);

    const getReq = new Request("http://localhost/api/webhooks/mercadopago/ipn?id=ipn-113-8&topic=payment", { method: "GET" });
    const getRes = await ipnGet(getReq);
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.received, true);
    assert.equal(getJson.processed, true);

    const postReq = new Request("http://localhost/api/webhooks/mercadopago/ipn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "https://api.mercadopago.com/v1/payments/ipn-113-8b", topic: "payment" }),
    });
    const postRes = await ipnPost(postReq);
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.equal(postJson.received, true);
    assert.equal(postJson.processed, true);

    assert.ok(fetchCalls.length >= 2, "IPN deve validar via consulta a API do Mercado Pago");
    for (const call of fetchCalls) {
      const auth = call.options && call.options.headers && call.options.headers.Authorization;
      assert.match(auth || "", /^Bearer\s+\S+$/, "IPN deve usar lookup autenticado com Bearer token");
    }
  } finally {
    restoreGlobals(snap);
  }
});

test("113.9 replay em producao: timestamp expirado rejeita com 401", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);

    const paymentId = "payment-113-9";
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const response = await webhookPost(
      signedPost({ paymentId, requestId: "req-113-9", secret: fakeSecret, timestamp: oldTimestamp }),
    );
    assert.equal(response.status, 401);
    const json = await response.json();
    assert.match(json.error, /expirada|replay/i);
    assert.equal(fetchCalls.length, 0, "replay nao deve alcancar a API do Mercado Pago");
  } finally {
    restoreGlobals(snap);
  }
});

test("113.10 idempotencia em producao: retry do mesmo payment_id preserva already_processed", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "production";
    globalThis.__mockWebhookSecret = fakeSecret;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);
    const state = { rpcCalls: 0 };
    globalThis.adminClient = countingAdminStub(state);

    const paymentId = "payment-113-10";
    const res1 = await webhookPost(signedPost({ paymentId, requestId: "req-113-10a", secret: fakeSecret }));
    assert.equal(res1.status, 200);
    const json1 = await res1.json();
    assert.equal(json1.processed, true);
    assert.equal(json1.already_processed, false);

    const res2 = await webhookPost(signedPost({ paymentId, requestId: "req-113-10b", secret: fakeSecret }));
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.processed, true);
    assert.equal(json2.already_processed, true, "retry do mesmo payment_id deve sinalizar already_processed");
    assert.equal(state.rpcCalls, 2);
  } finally {
    restoreGlobals(snap);
  }
});test("113.7b dev com opt-out explicito: MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET=false rejeita com 503", async () => {
  const snap = snapshotGlobals();
  try {
    process.env.NODE_ENV = "test";
    process.env.MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET = "false";
    globalThis.__mockWebhookSecret = null;
    const fetchCalls = [];
    globalThis.fetch = approvedPaymentHandler(fetchCalls);

    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-113-7b" }, type: "payment" }),
    });
    const response = await webhookPost(request);
    assert.equal(response.status, 503, "opt-out explicito deve falhar fechado mesmo fora de producao");
    const json = await response.json();
    assert.equal(json.error, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR);
    assert.equal(fetchCalls.length, 0, "deve rejeitar antes de consultar a API do Mercado Pago");
  } finally {
    restoreGlobals(snap);
  }
});