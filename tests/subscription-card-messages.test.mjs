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
    status: "pending",
  });

  assert.equal(result.isProActive, false);
  assert.equal(result.type, "info");
  assert.match(result.message, /ainda em processamento/i);
});

test("deriveVerifyFeedback: pagamento rejeitado", () => {
  const result = deriveVerifyFeedback({
    verified: true,
    payment_found: true,
    payment_processed_now: false,
    already_processed: false,
    subscription_active: false,
    subscription_status: "rejected",
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
