import assert from "node:assert/strict";
import test from "node:test";
import { deriveVerifyFeedback, deriveSyncFeedback } from "../src/lib/subscription/feedback.ts";

test("deriveVerifyFeedback: Caso 1 - webhook processa primeiro (already_processed=true, subscription_active=true)", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: true,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-10-20T12:00:00.000Z",
  });

  assert.equal(result.isProActive, true, "Pro deve estar ativo");
  assert.equal(result.type, "success", "Tipo deve ser success e nao info");
  assert.match(result.message, /já confirmado anteriormente|ativo e atualizado/i);
  assert.doesNotMatch(result.message, /processando/i, "NUNCA deve dizer que ainda esta em processamento");
});

test("deriveVerifyFeedback: novo pagamento processado com sucesso", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: true,
    already_processed: false,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-10-20T12:00:00.000Z",
  });

  assert.equal(result.isProActive, true);
  assert.equal(result.type, "success");
  assert.match(result.message, /ativado com sucesso/i);
});

test("deriveVerifyFeedback: pagamento pendente", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: false,
    subscription_active: false,
    subscription_status: "pending",
    payment_status: "pending",
    status: "pending",
  });

  assert.equal(result.isProActive, false);
  assert.equal(result.type, "info");
  assert.match(result.message, /ainda em processamento/i);
});

test("deriveVerifyFeedback: Pro ativo + novo pagamento pending deve avisar que Pro continua ativo e pagamento processando", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: false,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-10-20T12:00:00.000Z",
    payment_status: "pending",
    status: "pending",
  });

  assert.equal(result.isProActive, true, "Pro deve continuar ativo pela assinatura existente");
  assert.equal(result.type, "info");
  assert.equal(
    result.message,
    "Seu Plano Pro continua ativo. O novo pagamento ainda está sendo processado."
  );
  assert.doesNotMatch(result.message, /ativado com sucesso|confirmado/i, "NUNCA deve dizer que o novo pagamento foi confirmado");
});

test("deriveVerifyFeedback: Pro ativo + novo pagamento approved e recem-processado deve confirmar ativacao/renovacao", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: true,
    already_processed: false,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-11-20T12:00:00.000Z",
    payment_status: "approved",
    status: "active",
  });

  assert.equal(result.isProActive, true);
  assert.equal(result.type, "success");
  assert.match(result.message, /Pagamento confirmado! Seu plano Pro foi ativado com sucesso\./i);
});

test("deriveVerifyFeedback: pagamento rejected com Pro ativo NUNCA deve dizer que foi confirmado", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: false,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-10-20T12:00:00.000Z",
    payment_status: "rejected",
    status: "rejected",
  });

  assert.equal(result.isProActive, true, "Pro anterior continua ativo");
  assert.equal(result.type, "error", "Tipo deve ser error para alertar a falha do novo pagamento");
  assert.match(result.message, /não foi aprovado pelo Mercado Pago/i);
  assert.match(result.message, /continua ativo|permanece ativo/i);
  assert.doesNotMatch(result.message, /confirmado|ativado com sucesso/i, "NUNCA deve dizer que o pagamento foi confirmado");
});

test("deriveVerifyFeedback: pagamento rejeitado sem Pro ativo", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: false,
    subscription_active: false,
    subscription_status: "rejected",
    payment_status: "rejected",
    status: "rejected",
  });

  assert.equal(result.isProActive, false);
  assert.equal(result.type, "error");
  assert.match(result.message, /não foi aprovado/i);
});

test("deriveSyncFeedback: Caso 2 - pagamentos antigos encontrados com vigencia expirada (synced=true, subscription_status=expired)", () => {
  const result = deriveSyncFeedback({
    synced: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: true,
    subscription_active: false,
    subscription_status: "expired",
    current_period_end: "2026-08-01T12:00:00.000Z",
    total_payments: 1,
    newly_processed: 0,
    status: "expired",
  });

  assert.equal(result.isProActive, false, "Pro nao deve estar ativo se a vigencia expirou");
  assert.equal(result.type, "info");
  assert.match(result.message, /vigência do plano já expirou/i);
  assert.match(result.message, /realize uma nova assinatura/i);
  assert.doesNotMatch(result.message, /liberado/i, "NUNCA deve afirmar que o plano Pro foi liberado quando expirado");
});

test("deriveSyncFeedback: pagamento novo sincronizado e Pro ativado", () => {
  const result = deriveSyncFeedback({
    synced: true,
    payment_found: true,
    payment_processed_now: true,
    already_processed: false,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-10-20T12:00:00.000Z",
    total_payments: 1,
    newly_processed: 1,
    status: "active",
  });

  assert.equal(result.isProActive, true);
  assert.equal(result.type, "success");
  assert.match(result.message, /sincronizado com sucesso! Seu plano Pro foi ativado/i);
});

test("deriveSyncFeedback: assinatura ja ativa sincronizada", () => {
  const result = deriveSyncFeedback({
    synced: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: true,
    subscription_active: true,
    subscription_status: "active",
    current_period_end: "2026-10-20T12:00:00.000Z",
    total_payments: 1,
    newly_processed: 0,
    status: "active",
  });

  assert.equal(result.isProActive, true);
  assert.equal(result.type, "success");
  assert.match(result.message, /já está ativo e atualizado/i);
});

test("deriveSyncFeedback: nenhum pagamento aprovado encontrado", () => {
  const result = deriveSyncFeedback({
    synced: false,
    payment_found: false,
    payment_processed_now: false,
    already_processed: false,
    subscription_active: false,
    subscription_status: "trialing",
    total_payments: 0,
    newly_processed: 0,
    status: "trialing",
  });

  assert.equal(result.isProActive, false);
  assert.equal(result.type, "info");
  assert.match(result.message, /Nenhum pagamento aprovado vinculado a esta conta foi identificado/i);
});
