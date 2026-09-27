export interface VerifyPayload {
  verified?: boolean;
  payment_found?: boolean;
  payment_processed_now?: boolean;
  already_processed?: boolean;
  subscription_active?: boolean;
  subscription_status?: string;
  current_period_end?: string | null;
  payment_status?: string;
  activated?: boolean;
  status?: string;
  error?: string;
}

export interface SyncPayload {
  synced?: boolean;
  payment_found?: boolean;
  payment_processed_now?: boolean;
  already_processed?: boolean;
  subscription_active?: boolean;
  subscription_status?: string;
  current_period_end?: string | null;
  newly_processed?: number;
  total_payments?: number;
  status?: string;
  error?: string;
}

export interface FeedbackResult {
  message: string;
  type: "success" | "info" | "error";
  isProActive: boolean;
}

/**
 * Deriva a mensagem de feedback e o tipo da rota /api/mercadopago/verify
 * separando estritamente a vigência da assinatura (subscription_active)
 * da situação real do pagamento consultado (current_payment_approved / payment_status).
 */
export function deriveVerifyFeedback(payload: VerifyPayload): FeedbackResult {
  const isProActive = Boolean(
    payload.subscription_active ?? (payload.subscription_status === "active" || payload.status === "active" || payload.activated)
  );

  const rawPaymentStatus = (
    payload.payment_status ||
    (payload.status !== "active" && payload.status !== "expired" ? payload.status : undefined) ||
    (payload.payment_processed_now || payload.already_processed ? "approved" : "")
  ).toLowerCase();

  const isApproved = rawPaymentStatus === "approved" || Boolean(payload.payment_processed_now);
  const isPending = rawPaymentStatus === "pending" || rawPaymentStatus === "in_process";
  const isRejected = rawPaymentStatus === "rejected" || rawPaymentStatus === "cancelled";
  const isAlreadyProcessed = Boolean(payload.already_processed) && !payload.payment_processed_now;

  // 1. Cenário: Pagamento rejeitado ou cancelado
  // NUNCA dizer que foi confirmado, mesmo se a assinatura anterior ainda estiver ativa.
  if (isRejected) {
    if (isProActive) {
      return {
        message: "O novo pagamento não foi aprovado pelo Mercado Pago. Seu plano Pro permanece ativo pelo período atual, mas tente novamente com outro meio de pagamento para renovar.",
        type: "error",
        isProActive: true,
      };
    }
    return {
      message: "O pagamento não foi aprovado pelo Mercado Pago. Por favor, tente novamente com outro meio de pagamento.",
      type: "error",
      isProActive: false,
    };
  }

  // 2. Cenário: Pagamento pendente ou em processamento
  // Se Pro já estiver ativo por vigência anterior, informa que continua ativo enquanto o novo pagamento processa.
  if (isPending) {
    if (isProActive) {
      return {
        message: "Seu Plano Pro continua ativo. O novo pagamento ainda está sendo processado.",
        type: "info",
        isProActive: true,
      };
    }
    return {
      message: "Pagamento recebido e ainda em processamento. Atualizaremos seu plano assim que o Mercado Pago confirmar.",
      type: "info",
      isProActive: false,
    };
  }

  // 3. Cenário: Pagamento já processado anteriormente (already_processed)
  if (isAlreadyProcessed) {
    if (isProActive) {
      return {
        message: "Pagamento já confirmado anteriormente. Seu plano Pro está ativo e atualizado.",
        type: "success",
        isProActive: true,
      };
    }
    return {
      message: "Pagamento já confirmado anteriormente, mas a vigência do plano expirou.",
      type: "info",
      isProActive: false,
    };
  }

  // 4. Cenário: Pagamento aprovado e recém-processado
  if (isApproved || payload.payment_processed_now) {
    return {
      message: "Pagamento confirmado! Seu plano Pro foi ativado com sucesso.",
      type: "success",
      isProActive: true,
    };
  }

  // 5. Fallback geral
  if (isProActive) {
    return {
      message: "Seu Plano Pro continua ativo. O novo pagamento ainda está sendo processado.",
      type: "info",
      isProActive: true,
    };
  }

  return {
    message: "Pagamento recebido e ainda em processamento. Atualizaremos seu plano assim que o Mercado Pago confirmar.",
    type: "info",
    isProActive: false,
  };
}

/**
 * Deriva a mensagem de feedback e o tipo da rota /api/mercadopago/sync
 * com base estrita no estado real da assinatura.
 */
export function deriveSyncFeedback(payload: SyncPayload): FeedbackResult {
  const isProActive = Boolean(
    payload.subscription_active ?? (payload.status === "active")
  );
  const hasPayments = Boolean(
    payload.payment_found ?? ((payload.total_payments && payload.total_payments > 0) || payload.synced)
  );

  if (isProActive) {
    if (payload.payment_processed_now || (payload.newly_processed && payload.newly_processed > 0)) {
      return {
        message: "Pagamento sincronizado com sucesso! Seu plano Pro foi ativado.",
        type: "success",
        isProActive: true,
      };
    }
    return {
      message: "Assinatura sincronizada! Seu plano Pro já está ativo e atualizado.",
      type: "success",
      isProActive: true,
    };
  }

  if (hasPayments && (payload.subscription_status === "expired" || payload.status === "expired")) {
    return {
      message: "Identificamos pagamentos anteriores vinculados a esta conta, mas a vigência do plano já expirou. Para reativar o Pro, realize uma nova assinatura.",
      type: "info",
      isProActive: false,
    };
  }

  return {
    message: "Nenhum pagamento aprovado vinculado a esta conta foi identificado. Se você acabou de pagar via PIX, aguarde alguns instantes e tente novamente.",
    type: "info",
    isProActive: false,
  };
}
