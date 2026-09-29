import type { SupabaseClient } from "@supabase/supabase-js";
import { captureFinancialRpcError } from "@/lib/observability";
export function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV?.trim() === "production" || process.env.NODE_ENV?.trim() === "production";
}

export function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export function paymentBelongsToUser(
  p: { external_reference?: string | null; metadata?: { user_id?: string | null; userId?: string | null } | null },
  userId: string,
): boolean {
  if (!userId || !p) return false;
  const rawRef = (p.external_reference || "").trim();
  const [paymentUserId] = rawRef ? rawRef.split("#") : [""];
  const metadataUserId = (p.metadata?.user_id || p.metadata?.userId || "").trim();

  const hasRef = Boolean(paymentUserId);
  const hasMeta = Boolean(metadataUserId);

  if (!hasRef && !hasMeta) return false;

  if (hasRef && hasMeta) {
    return paymentUserId === userId && metadataUserId === userId;
  }

  if (hasRef) {
    return paymentUserId === userId;
  }

  return metadataUserId === userId;
}

// ─── Catálogo Canônico de Assinaturas (MAI-137) ──────────────────────────────
export const DEFAULT_CATALOG_VERSION = "2026-v1";
export const SUPPORTED_CURRENCY = "BRL" as const;

export const SUBSCRIPTION_PERIODS = [1, 3, 6, 12] as const;
export type SubscriptionMonths = (typeof SUBSCRIPTION_PERIODS)[number];

export interface CanonicalPlan {
  readonly id: string;
  readonly planKey: "pro";
  readonly months: SubscriptionMonths;
  readonly label: string;
  readonly price: number;
  readonly priceCents: number;
  readonly currency: typeof SUPPORTED_CURRENCY;
  readonly validityDays: number;
  readonly monthlyEquivalent: number;
  readonly badge?: string;
  readonly catalogVersion: string;
}

export const CANONICAL_PLANS: readonly CanonicalPlan[] = [
  {
    id: "meuplantao-pro-1",
    planKey: "pro",
    months: 1,
    label: "Mensal",
    price: 12.9,
    priceCents: 1290,
    currency: SUPPORTED_CURRENCY,
    validityDays: 30,
    monthlyEquivalent: 12.9,
    catalogVersion: DEFAULT_CATALOG_VERSION,
  },
  {
    id: "meuplantao-pro-3",
    planKey: "pro",
    months: 3,
    label: "Trimestral",
    price: 38.7,
    priceCents: 3870,
    currency: SUPPORTED_CURRENCY,
    validityDays: 90,
    monthlyEquivalent: 12.9,
    catalogVersion: DEFAULT_CATALOG_VERSION,
  },
  {
    id: "meuplantao-pro-6",
    planKey: "pro",
    months: 6,
    label: "Semestral",
    price: 69.9,
    priceCents: 6990,
    currency: SUPPORTED_CURRENCY,
    validityDays: 180,
    monthlyEquivalent: 11.65,
    badge: "Mais escolhido",
    catalogVersion: DEFAULT_CATALOG_VERSION,
  },
  {
    id: "meuplantao-pro-12",
    planKey: "pro",
    months: 12,
    label: "Anual",
    price: 129.9,
    priceCents: 12990,
    currency: SUPPORTED_CURRENCY,
    validityDays: 365,
    monthlyEquivalent: 10.825,
    badge: "Melhor valor · 2 meses grátis",
    catalogVersion: DEFAULT_CATALOG_VERSION,
  },
] as const;

export function getCanonicalPlanByMonths(months: number, version = DEFAULT_CATALOG_VERSION): CanonicalPlan | undefined {
  return CANONICAL_PLANS.find((plan) => plan.months === months && plan.catalogVersion === version)
    ?? CANONICAL_PLANS.find((plan) => plan.months === months);
}

export function getCanonicalPlanById(id: string, version = DEFAULT_CATALOG_VERSION): CanonicalPlan | undefined {
  return CANONICAL_PLANS.find((plan) => plan.id === id && plan.catalogVersion === version)
    ?? CANONICAL_PLANS.find((plan) => plan.id === id);
}

export function isSupportedMonths(months: number): months is SubscriptionMonths {
  return SUBSCRIPTION_PERIODS.includes(months as SubscriptionMonths);
}

export function isSupportedPlanId(id: string): boolean {
  return CANONICAL_PLANS.some((plan) => plan.id === id);
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export const validityDaysByMonths = new Map<number, number>(
  CANONICAL_PLANS.map((plan) => [plan.months, plan.validityDays])
);

export function getValidityDays(months?: number): number {
  if (!months) return 30;
  return getCanonicalPlanByMonths(months)?.validityDays ?? validityDaysByMonths.get(months) ?? 30;
}

export function addValidity(start: Date, days: number): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return end;
}

// ─── Tipos e Validação de Pagamento Pré-Concessão (MAI-137) ─────────────────
export interface MercadoPagoPaymentPayload {
  id?: string | number;
  status?: string;
  currency_id?: string | null;
  transaction_amount?: number | null;
  external_reference?: string | null;
  items?: Array<{ id?: string; unit_price?: number; quantity?: number; currency_id?: string }>;
  additional_info?: {
    items?: Array<{ id?: string; unit_price?: number; quantity?: number; currency_id?: string }>;
  };
  metadata?: {
    user_id?: string | null;
    userId?: string | null;
    checkout_id?: string | null;
    checkoutId?: string | null;
    months?: number | null;
    plan_id?: string | null;
  };
  order?: { id?: string | number; type?: string };
}

export type PaymentValidationResult =
  | {
      valid: true;
      userId: string;
      planId: string;
      months: SubscriptionMonths;
      validityDays: number;
      amount: number;
      amountCents: number;
      currency: "BRL";
      checkoutId: string | null;
      catalogVersion: string;
      isLegacy: boolean;
    }
  | {
      valid: false;
      quarantine: true;
      forbidden?: false;
      reason: string;
      userId: string | null;
      details?: Record<string, unknown>;
    }
  | {
      valid: false;
      quarantine: false;
      forbidden?: boolean;
      status?: string;
      reason: string;
    };

/**
 * Validação rigorosa de pagamentos do Mercado Pago antes de qualquer concessão de Pro.
 * Garante status aprovado, ownership, moeda BRL, produto válido, cotação e valor exato.
 */
export async function validatePaymentBeforeGrantingPro(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  payment: MercadoPagoPaymentPayload,
  expectedUserId?: string,
): Promise<PaymentValidationResult> {
  // 1. Status aprovado obrigatório
  if (payment.status !== "approved") {
    return {
      valid: false,
      quarantine: false,
      status: payment.status,
      reason: "payment_not_approved",
    };
  }

  // 2. Resolução e validação de Ownership
  const rawRef = (payment.external_reference || "").trim();
  const refParts = rawRef ? rawRef.split("#") : [];
  const externalUserId = refParts[0] || "";
  const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

  if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
    return {
      valid: false,
      quarantine: true,
      reason: "divergent_user_identifiers",
      userId: null,
      details: { externalUserId, metadataUserId },
    };
  }

  const userId = externalUserId || metadataUserId;

  if (expectedUserId && !paymentBelongsToUser(payment, expectedUserId)) {
    return {
      valid: false,
      quarantine: false,
      forbidden: true,
      reason: "payment_belongs_to_another_user",
    };
  }

  if (!isUserId(userId)) {
    return {
      valid: false,
      quarantine: true,
      reason: "invalid_or_missing_user_id",
      userId: null,
      details: { userId },
    };
  }

  // 3. Validação estrita de Moeda (apenas BRL permitido)
  const currency = (payment.currency_id || "").toUpperCase().trim();
  if (currency && currency !== "BRL") {
    return {
      valid: false,
      quarantine: true,
      reason: "unsupported_currency",
      userId,
      details: { currency },
    };
  }

  // 4. Validação de identificador de produto/itens (se presentes)
  const items = payment.additional_info?.items || payment.items || [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.id && !isSupportedPlanId(item.id)) {
        return {
          valid: false,
          quarantine: true,
          reason: "unrecognized_product",
          userId,
          details: { itemId: item.id },
        };
      }
    }
  }

  // 5. Verificação de cotação / checkout persistido no servidor
  let checkoutId: string | null = null;
  const metaCheckoutId = payment.metadata?.checkout_id || payment.metadata?.checkoutId;
  if (metaCheckoutId && isUserId(metaCheckoutId)) {
    checkoutId = metaCheckoutId;
  } else if (refParts.length >= 2) {
    for (let i = 1; i < refParts.length; i++) {
      if (isUserId(refParts[i])) {
        checkoutId = refParts[i];
        break;
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkoutRow: Record<string, any> | null = null;
  if (checkoutId && typeof admin?.from === "function") {
    try {
      const { data } = await admin
        .from("subscription_checkouts")
        .select("*")
        .eq("id", checkoutId)
        .eq("user_id", userId)
        .maybeSingle();
      if (data) checkoutRow = data;
    } catch {
      // Falha defensiva se a tabela ainda não estiver migrada
    }
  }

  // Se checkout persistido foi encontrado: valida contra a cotação fixada
  if (checkoutRow) {
    if (checkoutRow.currency !== "BRL") {
      return {
        valid: false,
        quarantine: true,
        reason: "checkout_currency_unsupported",
        userId,
        details: { checkoutCurrency: checkoutRow.currency },
      };
    }

    if (payment.transaction_amount !== null && payment.transaction_amount !== undefined) {
      const paymentCents = toCents(payment.transaction_amount);
      const expectedCents = Number(checkoutRow.amount_cents);
      if (paymentCents !== expectedCents) {
        return {
          valid: false,
          quarantine: true,
          reason: "amount_mismatch",
          userId,
          details: { paymentCents, expectedCents, checkoutId: checkoutRow.id },
        };
      }
    }

    if (items.length > 0 && items[0]?.id && items[0].id !== checkoutRow.plan_id) {
      return {
        valid: false,
        quarantine: true,
        reason: "product_mismatch",
        userId,
        details: { itemId: items[0].id, checkoutPlanId: checkoutRow.plan_id },
      };
    }

    return {
      valid: true,
      userId,
      planId: String(checkoutRow.plan_id),
      months: Number(checkoutRow.months) as SubscriptionMonths,
      validityDays: Number(checkoutRow.validity_days),
      amount: Number(checkoutRow.amount),
      amountCents: Number(checkoutRow.amount_cents),
      currency: "BRL",
      checkoutId: String(checkoutRow.id),
      catalogVersion: String(checkoutRow.catalog_version || "2026-v1"),
      isLegacy: false,
    };
  }

  // 6. Sem checkout persistido encontrado: validação direta contra o Catálogo Canônico
  let rawMonths = 1;
  if (payment.metadata?.months) {
    rawMonths = Number(payment.metadata.months);
  } else if (refParts.length >= 2 && !isNaN(Number(refParts[1]))) {
    rawMonths = Number(refParts[1]);
  }

  if (!isSupportedMonths(rawMonths)) {
    return {
      valid: false,
      quarantine: true,
      reason: "unsupported_period",
      userId,
      details: { rawMonths },
    };
  }

  const canonicalPlan: CanonicalPlan | undefined = getCanonicalPlanByMonths(rawMonths);
  if (!canonicalPlan) {
    return {
      valid: false,
      quarantine: true,
      reason: "unsupported_period",
      userId,
      details: { rawMonths },
    };
  }

  // Verifica produto do item com o plano esperado
  if (items.length > 0 && items[0]?.id && items[0].id !== canonicalPlan.id) {
    return {
      valid: false,
      quarantine: true,
      reason: "product_mismatch",
      userId,
      details: { itemId: items[0].id, expectedPlanId: canonicalPlan.id },
    };
  }

  // Validação do valor em centavos
  if (payment.transaction_amount !== null && payment.transaction_amount !== undefined) {
    const paymentCents = toCents(payment.transaction_amount);
    const expectedCents = canonicalPlan.priceCents;
    if (paymentCents !== expectedCents) {
      return {
        valid: false,
        quarantine: true,
        reason: "amount_mismatch",
        userId,
        details: { paymentCents, expectedCents, months: canonicalPlan.months },
      };
    }
  } else if (isProductionEnvironment()) {
    return {
      valid: false,
      quarantine: true,
      reason: "missing_transaction_amount",
      userId,
    };
  }

  return {
    valid: true,
    userId,
    planId: canonicalPlan.id,
    months: canonicalPlan.months,
    validityDays: canonicalPlan.validityDays,
    amount: canonicalPlan.price,
    amountCents: canonicalPlan.priceCents,
    currency: "BRL",
    checkoutId: null,
    catalogVersion: canonicalPlan.catalogVersion,
    isLegacy: !checkoutId,
  };
}

/**
 * Persiste pagamento em quarentena para auditoria humana sem perda de histórico.
 */
export async function quarantinePayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  params: {
    paymentId: string | number;
    userId: string | null;
    reason: string;
    amount?: number | string | null;
    currency?: string | null;
    months?: number | null;
    rawPayload?: Record<string, unknown>;
  },
): Promise<void> {
  if (!params.paymentId || typeof admin?.from !== "function") return;
  try {
    await admin.from("subscription_payments_quarantine").insert({
      mercadopago_payment_id: String(params.paymentId),
      user_id: params.userId,
      reason: params.reason,
      amount: params.amount !== null && params.amount !== undefined ? Number(params.amount) : null,
      currency: params.currency || null,
      months: params.months || null,
      raw_payload: params.rawPayload || {},
      status: "quarantined",
    });
  } catch {
    // Fail-safe: não interrompe o fluxo caso a tabela esteja em migração ou em mock
  }
}

/**
 * Marca a intenção de checkout como completada após sucesso do processamento atômico.
 */
export async function completeSubscriptionCheckout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  checkoutId: string,
): Promise<void> {
  if (!checkoutId || typeof admin?.from !== "function") return;
  try {
    await admin
      .from("subscription_checkouts")
      .update({ status: "completed" })
      .eq("id", checkoutId);
  } catch {
    // Fail-safe
  }
}

// ─── Processamento Atômico do Pagamento ──────────────────────────────────────
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
