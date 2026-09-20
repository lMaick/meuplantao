export interface VerifyPayload {
  verified?: boolean;
  payment_found?: boolean;
  payment_processed_now?: boolean;
  already_processed?: boolean;
  subscription_active?: boolean;
  subscription_status?: string;
  current_period_end?: string | null;
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
 * com base estrita no estado real da assinatura.
 */
export function deriveVerifyFeedback(payload: VerifyPayload): FeedbackResult {
  const isProActive = Boolean(
    payload.subscription_active ?? (payload.status === "active" || payload.activated)
  );

  if (isProActive) {
    if (payload.already_processed && !payload.payment_processed_now) {
      return {
        message: "Pagamento já confirmado anteriormente. Seu plano Pro está ativo e atualizado.",
        type: "success",
        isProActive: true,
      };
    }
    return {
      message: "Pagamento confirmado! Seu plano Pro foi ativado com sucesso.",
      type: "success",
      isProActive: true,
    };
  }

  if (payload.status === "in_process" || payload.status === "pending") {
    return {
      message: "Pagamento recebido e ainda em processamento. Atualizaremos seu plano assim que o Mercado Pago confirmar.",
      type: "info",
      isProActive: false,
    };
  }

  if (payload.status === "rejected" || payload.status === "cancelled") {
    return {
      message: "O pagamento não foi aprovado pelo Mercado Pago. Por favor, tente novamente com outro meio de pagamento.",
      type: "error",
      isProActive: false,
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
