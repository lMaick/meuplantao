import type { SupabaseClient } from "@supabase/supabase-js";
import { captureFinancialRpcError } from "@/lib/observability";

/** Estados definitivos de reversao que revogam vigencia (MP: refunded/charged_back). */
export const REVERSAL_STATUSES = new Set(["refunded", "charged_back"]);

/** Estados de disputa que exigem decisao humana e NAO revogam automaticamente. */
export const DISPUTE_STATUSES = new Set(["in_mediation", "mediation", "dispute", "chargeback_pending"]);

export function normalizeProviderStatus(status?: string | null): string {
  return (status || "").trim().toLowerCase();
}

export function isReversalStatus(status?: string | null): boolean {
  return REVERSAL_STATUSES.has(normalizeProviderStatus(status));
}

export function isDisputeStatus(status?: string | null): boolean {
  return DISPUTE_STATUSES.has(normalizeProviderStatus(status));
}

export interface ReconcileReversalParams {
  paymentId: string | number;
  userId: string;
  reversalStatus: string;
  months?: number;
  validityDays?: number;
  amount?: number | string | null;
}

export interface ReconcileReversalResult {
  reversed: boolean;
  already_reversed: boolean;
  not_found: boolean;
  ownership_mismatch: boolean;
  contributed: boolean;
  current_period_end: string | null;
  status: string;
  active_payments: number;
  validity_days_removed: number;
}

/**
 * Reconcilia um reembolso/chargeback de forma idempotente e atomica.
 * Nunca apaga pagamentos: atualiza o status no ledger, registra o evento
 * em subscription_payment_events e recompoe a vigencia a partir dos
 * pagamentos ativos remanescentes (ver migration MAI-136).
 */
export async function reconcileMercadoPagoReversal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  params: ReconcileReversalParams,
): Promise<ReconcileReversalResult> {
  const paymentId = String(params.paymentId).trim();
  const userId = params.userId.trim();
  const reversalStatus = normalizeProviderStatus(params.reversalStatus);
  const months = params.months && params.months > 0 ? params.months : 1;
  const validityDays = params.validityDays && params.validityDays > 0 ? params.validityDays : 30;
  const amount = params.amount !== null && params.amount !== undefined
    ? Number(params.amount)
    : null;

  if (!paymentId) throw new Error("Identificador do pagamento Mercado Pago ausente");
  if (!userId) throw new Error("Identificador do usuario ausente");
  if (!isReversalStatus(reversalStatus)) {
    throw new Error("Status de reversao invalido (esperado refunded ou charged_back)");
  }

  const { data, error } = await admin.rpc("reconcile_mercadopago_reversal", {
    p_payment_id: paymentId,
    p_user_id: userId,
    p_reversal_status: reversalStatus,
    p_months: months,
    p_validity_days: validityDays,
    p_amount: amount,
  });

  if (error) {
    captureFinancialRpcError(error, {
      rpcName: "reconcile_mercadopago_reversal",
      paymentId,
      userId,
      extra: { months, validityDays, amount, reversalStatus },
    });
    throw new Error("Falha na reconciliacao do estorno");
  }

  if (!data || typeof data !== "object") {
    throw new Error("RPC de reversao nao retornou dados validos");
  }

  const r = data as Record<string, unknown>;
  return {
    reversed: Boolean(r.reversed),
    already_reversed: Boolean(r.already_reversed),
    not_found: Boolean(r.not_found),
    ownership_mismatch: Boolean(r.ownership_mismatch),
    contributed: Boolean(r.contributed),
    current_period_end: typeof r.current_period_end === "string" ? r.current_period_end : null,
    status: typeof r.status === "string" ? r.status : "expired",
    active_payments: typeof r.active_payments === "number" ? r.active_payments : 0,
    validity_days_removed: typeof r.validity_days_removed === "number" ? r.validity_days_removed : 0,
  };
}
