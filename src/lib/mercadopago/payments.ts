import type { SupabaseClient } from "@supabase/supabase-js";

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
    console.error("Erro na RPC de processamento atômico de pagamento:", error);
    throw new Error(`Falha no processamento atomico do pagamento: ${error.message || "RPC error"}`);
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
