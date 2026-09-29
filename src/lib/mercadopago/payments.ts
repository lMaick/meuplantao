import type { SupabaseClient } from "@supabase/supabase-js";
import { captureFinancialRpcError } from "@/lib/observability";

export const validityDaysByMonths = new Map<number, number>([
  [1, 30],
  [3, 90],
  [6, 180],
  [12, 365],
]);

export function getValidityDays(months?: number): number {
  if (!months) return 30;
  return validityDaysByMonths.get(months) ?? 30;
}

export function addValidity(start: Date, days: number): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return end;
}

export interface ProcessPaymentParams {
  paymentId: string | number;
  userId: string;
  months?: number;
  validityDays?: number;
  amount?: number | string | null;
  status?: string | null;
}

export interface ProcessPaymentResult {
  already_processed: boolean;
  current_period_end: string | null;
  validity_days_added: number;
  status: string;
}

/**
 * MAI-138 — Prova de idempotência: indica se um payment_id já foi persistido
 * com sucesso em `subscription_payments`.
 *
 * Usado pelo dedupe de webhook/IPN: só responde `200 deduped` (sem consultar
 * o Mercado Pago) quando há prova de persistência. Sem prova — concorrência
 * em voo ou falha anterior — a notificação é PROCESSADA normalmente (a RPC
 * atômica garante que a vigência só é estendida uma vez), nunca descartada.
 * Falha na consulta = sem prova (fail-open para processar, nunca descartar).
 */
export async function hasProcessedMercadoPagoPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  paymentId: string | number,
): Promise<boolean> {
  const normalized = String(paymentId ?? "").trim();
  if (!normalized) return false;
  try {
    const query = admin.from("subscription_payments");
    if (!query || typeof query.select !== "function") return false;
    const { data, error } = await query
      .select("mercadopago_payment_id")
      .eq("mercadopago_payment_id", normalized)
      .maybeSingle();
    if (error || !data) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Processa um pagamento do Mercado Pago de forma idempotente e atômica.
 * Garante que cada payment_id único só adicione vigência à assinatura exatamente uma vez.
 */
export async function processMercadoPagoPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  params: ProcessPaymentParams,
): Promise<ProcessPaymentResult> {
  const paymentId = String(params.paymentId).trim();
  const userId = params.userId.trim();
  const months = params.months && params.months > 0 ? params.months : 1;
  const validityDays = params.validityDays && params.validityDays > 0
    ? params.validityDays
    : getValidityDays(months);
  const amount = params.amount !== null && params.amount !== undefined
    ? Number(params.amount)
    : null;
  const status = params.status || "approved";

  if (!paymentId) {
    throw new Error("Identificador do pagamento Mercado Pago ausente");
  }
  if (!userId) {
    throw new Error("Identificador do usuario ausente");
  }

  // Execução estritamente atômica e fail-closed via RPC do Supabase
  // Nenhum caminho alternativo pode alterar subscriptions sem garantia atômica de idempotência
  const { data, error } = await admin.rpc("process_mercadopago_subscription_payment", {
    p_payment_id: paymentId,
    p_user_id: userId,
    p_months: months,
    p_validity_days: validityDays,
    p_amount: amount,
    p_status: status,
  });

  if (error) {
    captureFinancialRpcError(error, {
      rpcName: "process_mercadopago_subscription_payment",
      paymentId,
      userId,
      extra: { months, validityDays, amount, status },
    });
    throw new Error("Falha no processamento atomico do pagamento");
  }

  if (!data || typeof data !== "object") {
    throw new Error("RPC de pagamento nao retornou dados validos");
  }

  const result = data as Record<string, unknown>;
  const isAlreadyProcessed = Boolean(result.already_processed);
  const currentPeriodEnd = typeof result.current_period_end === "string" ? result.current_period_end : null;
  const validityDaysAdded = typeof result.validity_days_added === "number"
    ? result.validity_days_added
    : (isAlreadyProcessed ? 0 : validityDays);
  const derivedStatus = typeof result.status === "string" ? result.status : "active";

  return {
    already_processed: isAlreadyProcessed,
    current_period_end: currentPeriodEnd,
    validity_days_added: validityDaysAdded,
    status: derivedStatus,
  };
}
