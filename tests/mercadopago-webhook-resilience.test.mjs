import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

const __whTestFile = fileURLToPath(import.meta.url);
const __whTrialUrl = pathToFileURL(path.join(path.dirname(__whTestFile), "..", "src", "lib", "subscription", "trial.ts")).href;
const __whPaymentsUrl = pathToFileURL(path.join(path.dirname(__whTestFile), "..", "src", "lib", "mercadopago", "payments.ts")).href;
const __whWebhookUrl = pathToFileURL(path.join(path.dirname(__whTestFile), "..", "src", "lib", "mercadopago", "webhook.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/subscription/trial") {
      return { url: __whTrialUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/payments") {
      return { url: __whPaymentsUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/webhook") {
      return { url: __whWebhookUrl, shortCircuit: true };
    }
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: "data:text/javascript,export const getMercadoPagoAccessToken = () => 'mp-test-token'; export const getMercadoPagoWebhookSecret = () => globalThis.__mockWebhookSecret ?? null; export const getMercadoPagoApiUrl = () => 'https://api.mercadopago.test'; export const getApplicationOrigin = () => 'https://app.example.com';",
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

const { GET: webhookGet, POST: webhookPost, validateWebhookSignature } = await import("../src/app/api/webhooks/mercadopago/route.ts");
const { GET: ipnGet, POST: ipnPost } = await import("../src/app/api/webhooks/mercadopago/ipn/route.ts");

const validUserId = "22222222-2222-4222-8222-222222222222";

function generateSignature(paymentId, requestId, timestamp, secret) {
  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

// -------------------------------------------------------------
// 1. Assinatura Ausente
// -------------------------------------------------------------
test("1. Assinatura ausente: rejeita com HTTP 401 quando secret está configurado", async () => {
  globalThis.__mockWebhookSecret = "test-webhook-secret";

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-101" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.match(json.error, /ausente/i);

  globalThis.__mockWebhookSecret = null;
});

// -------------------------------------------------------------
// 2. Assinatura Inválida
// -------------------------------------------------------------
test("2. Assinatura inválida: rejeita com HTTP 401 quando HMAC for incorreto", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "payment-102";
  const requestId = "req-test-102";
  const currentTs = Math.floor(Date.now() / 1000);

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${currentTs},v1=hashinvalido1234567890abcdef`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.match(json.error, /invalida/i);

  globalThis.__mockWebhookSecret = null;
});

// -------------------------------------------------------------
// 3. Assinatura Correta (Segundos e Milissegundos)
// -------------------------------------------------------------
test("3. Assinatura correta com timestamp em segundos (10 dígitos): autentica com sucesso e processa o pagamento", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "payment-103";
  const requestId = "req-test-103";
  const currentTs = Math.floor(Date.now() / 1000);
  const validHash = generateSignature(paymentId, requestId, currentTs, secret);

  globalThis.fetch = async (url) => {
    assert.equal(url, `https://api.mercadopago.test/v1/payments/${paymentId}`);
    return new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  };

  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      assert.equal(fn, "process_mercadopago_subscription_payment");
      assert.equal(params.p_payment_id, paymentId);
      assert.equal(params.p_user_id, validUserId);
      return {
        data: {
          already_processed: false,
          current_period_end: futureEnd,
          validity_days_added: 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${currentTs},v1=${validHash}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.processed, true);
  assert.equal(json.current_period_end, futureEnd);

  globalThis.__mockWebhookSecret = null;
});

test("3b. Assinatura correta com timestamp em milissegundos (13 dígitos): autentica com sucesso e processa o pagamento", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "payment-103-ms";
  const requestId = "req-test-103-ms";
  const currentTsMs = Date.now(); // 13 dígitos
  const validHash = generateSignature(paymentId, requestId, currentTsMs, secret);

  globalThis.fetch = async (url) => {
    assert.equal(url, `https://api.mercadopago.test/v1/payments/${paymentId}`);
    return new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  };

  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      assert.equal(fn, "process_mercadopago_subscription_payment");
      assert.equal(params.p_payment_id, paymentId);
      assert.equal(params.p_user_id, validUserId);
      return {
        data: {
          already_processed: false,
          current_period_end: futureEnd,
          validity_days_added: 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${currentTsMs},v1=${validHash}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.processed, true);
  assert.equal(json.current_period_end, futureEnd);

  globalThis.__mockWebhookSecret = null;
});

// -------------------------------------------------------------
// 4. Replay Attack & Timestamp Validation
// -------------------------------------------------------------
test("4a. Replay: rejeita com HTTP 401 se o timestamp em segundos for superior a 5 minutos", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "payment-104-sec";
  const requestId = "req-test-104-sec";
  // Timestamp com 10 minutos (600s) no passado em segundos
  const oldTsSec = Math.floor(Date.now() / 1000) - 600;
  const validHashForOldTs = generateSignature(paymentId, requestId, oldTsSec, secret);

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${oldTsSec},v1=${validHashForOldTs}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.match(json.error, /expirada|replay/i);

  globalThis.__mockWebhookSecret = null;
});

test("4b. Replay: rejeita com HTTP 401 se o timestamp em milissegundos for superior a 5 minutos", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "payment-104-ms";
  const requestId = "req-test-104-ms";
  // Timestamp com 10 minutos (600.000ms) no passado em milissegundos
  const oldTsMs = Date.now() - 600000;
  const validHashForOldTs = generateSignature(paymentId, requestId, oldTsMs, secret);

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${oldTsMs},v1=${validHashForOldTs}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.match(json.error, /expirada|replay/i);

  globalThis.__mockWebhookSecret = null;
});

test("4c. Timestamp inválido (não numérico, <= 0): rejeita com HTTP 401", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  for (const invalidTs of ["not-a-number", "-1000", "0"]) {
    const paymentId = "payment-invalid-ts";
    const requestId = "req-test-inv-ts";
    const hash = generateSignature(paymentId, requestId, invalidTs, secret);

    const request = new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": `ts=${invalidTs},v1=${hash}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify({ data: { id: paymentId }, type: "payment" }),
    });

    const response = await webhookPost(request);
    assert.equal(response.status, 401, `Timestamp ${invalidTs} deve ser rejeitado com 401`);
    const json = await response.json();
    assert.match(json.error, /invalido/i);
  }

  globalThis.__mockWebhookSecret = null;
});

test("4d. Formato real de notificação: POST /api/webhooks/mercadopago?data.id=123456&type=payment preservando data.id no manifesto", async () => {
  const secret = "test-webhook-secret";
  globalThis.__mockWebhookSecret = secret;

  const paymentId = "123456";
  const requestId = "req-real-format-123456";
  const currentTsMs = Date.now();
  // Manifest usa o paymentId extraído de data.id da query: id:123456;request-id:...;ts:...;
  const validHash = generateSignature(paymentId, requestId, currentTsMs, secret);

  globalThis.fetch = async (url) => {
    assert.equal(url, `https://api.mercadopago.test/v1/payments/${paymentId}`);
    return new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });
  };

  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  globalThis.adminClient = {
    rpc: async (fn, params) => {
      assert.equal(fn, "process_mercadopago_subscription_payment");
      assert.equal(params.p_payment_id, paymentId);
      assert.equal(params.p_user_id, validUserId);
      return {
        data: {
          already_processed: false,
          current_period_end: futureEnd,
          validity_days_added: 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  // Notificação no formato real enviado pelo Checkout Pro / Preferences API
  const request = new Request(`http://localhost/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${currentTsMs},v1=${validHash}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ action: "payment.created", api_version: "v1", data: { id: paymentId }, date_created: new Date().toISOString(), type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.processed, true);

  globalThis.__mockWebhookSecret = null;
});

// -------------------------------------------------------------
// 5. Payment_id Inexistente (404 na API MP)
// -------------------------------------------------------------
test("5. Payment_id inexistente: responde HTTP 200 ignored quando a API do MP retorna 404", async () => {
  globalThis.__mockWebhookSecret = null;

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Payment not found" }), { status: 404 });

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "non-existent-999" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.ignored, true);
  assert.match(json.error, /inexistente/i);
});

// -------------------------------------------------------------
// 6. Resiliência: Falha 5xx, Erro de Rede e Rate Limit (429)
// -------------------------------------------------------------
test("6a. Falha 5xx do MP: responde HTTP 502 para forçar retry automático do provedor", async () => {
  globalThis.__mockWebhookSecret = null;

  // Simula indisponibilidade temporária no Mercado Pago (HTTP 500 ou 503)
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Internal server error" }), { status: 503 });

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-503" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 502, "Deve retornar 502 Bad Gateway para o MP retentar");
  const json = await response.json();
  assert.match(json.error, /temporaria/i);
});

test("6b. Erro de rede/fetch: responde HTTP 502 para forçar retry automático do provedor", async () => {
  globalThis.__mockWebhookSecret = null;

  globalThis.fetch = async () => {
    throw new Error("fetch failed: ECONNRESET");
  };

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-network-err" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 502, "Erro de rede deve responder 502 para retry");
  const json = await response.json();
  assert.match(json.error, /temporaria|conexao/i);
});

test("6c. Rate Limit (429) do MP: responde HTTP 429 para retry posterior do provedor", async () => {
  globalThis.__mockWebhookSecret = null;

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429 });

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-rate-limited" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 429, "Rate limit deve responder 429");
  const json = await response.json();
  assert.match(json.error, /rate limit/i);
});

// -------------------------------------------------------------
// 7. Pagamento Não Aprovado
// -------------------------------------------------------------
test("7. Pagamento não aprovado: responde HTTP 200 ignored para status pending/in_process", async () => {
  globalThis.__mockWebhookSecret = null;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "pending", external_reference: validUserId }), { status: 200 });

  const request = new Request("http://localhost/api/webhooks/mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { id: "payment-pending" }, type: "payment" }),
  });

  const response = await webhookPost(request);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.received, true);
  assert.equal(json.ignored, true);
  assert.equal(json.status, "pending");
});

// -------------------------------------------------------------
// 8. Pagamento Aprovado & Idempotência
// -------------------------------------------------------------
test("8. Pagamento aprovado e idempotência: ativa na 1ª vez e preserva idempotência na repetição", async () => {
  globalThis.__mockWebhookSecret = null;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "approved", external_reference: validUserId, transaction_amount: 12.9 }), { status: 200 });

  let rpcCalls = 0;
  const futureEnd = new Date(Date.now() + 30 * 86400000).toISOString();

  globalThis.adminClient = {
    rpc: async (fn, params) => {
      rpcCalls++;
      return {
        data: {
          already_processed: rpcCalls > 1,
          current_period_end: futureEnd,
          validity_days_added: rpcCalls > 1 ? 0 : 30,
          status: "active",
        },
        error: null,
      };
    },
  };

  const createReq = () =>
    new Request("http://localhost/api/webhooks/mercadopago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { id: "payment-approved-888" }, type: "payment" }),
    });

  // 1ª execução: novo pagamento aprovado
  const res1 = await webhookPost(createReq());
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.received, true);
  assert.equal(json1.processed, true);
  assert.equal(json1.already_processed, false);

  // 2ª execução: idempotência preservada
  const res2 = await webhookPost(createReq());
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.received, true);
  assert.equal(json2.processed, true);
  assert.equal(json2.already_processed, true, "already_processed deve ser true no retry do mesmo payment_id");
  assert.equal(rpcCalls, 2);
});

// -------------------------------------------------------------
// 9. Rota Legada IPN (/api/webhooks/mercadopago/ipn)
// -------------------------------------------------------------
test("9. IPN legado: rota /api/webhooks/mercadopago/ipn processa GET e POST sem x-signature", async () => {
  globalThis.__mockWebhookSecret = "test-secret-that-does-not-block-ipn";

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: "approved", external_reference: validUserId }), { status: 200 });

  globalThis.adminClient = {
    rpc: async () => ({
      data: {
        already_processed: false,
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        validity_days_added: 30,
        status: "active",
      },
      error: null,
    }),
  };

  // Teste GET em IPN
  const getReq = new Request("http://localhost/api/webhooks/mercadopago/ipn?id=ipn-12345&topic=payment", {
    method: "GET",
  });
  const getRes = await ipnGet(getReq);
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.received, true);
  assert.equal(getJson.processed, true);

  // Teste POST em IPN
  const postReq = new Request("http://localhost/api/webhooks/mercadopago/ipn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: "https://api.mercadopago.com/v1/payments/ipn-67890", topic: "payment" }),
  });
  const postRes = await ipnPost(postReq);
  assert.equal(postRes.status, 200);
  const postJson = await postRes.json();
  assert.equal(postJson.received, true);
  assert.equal(postJson.processed, true);

  globalThis.__mockWebhookSecret = null;
});
