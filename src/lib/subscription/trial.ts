import type { TrialInfo } from "./types";

export const TRIAL_DURATION_DAYS = 14;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Preço mensal do plano Pro (R$) — cada pagamento aprovado adiciona vigência. */
export const PRO_MONTHLY_PRICE = 12.9;
/** Dias de cobertura adicionados por pagamento Pro aprovado. */
export const DAYS_PER_PRO_PAYMENT = 30;

export interface ApprovedPaymentLike {
  status?: string | null;
  date_created?: string | null;
  date_approved?: string | null;
  transaction_amount?: number | string | null;
}

/**
 * Conta pagamentos Pro válidos: status approved e valor compatível com
 * PRO_MONTHLY_PRICE quando o valor está presente (tolerância para
 * arredondamento/string). Pagamentos sem valor informado são contados
 * (compatibilidade com payloads legados do Mercado Pago).
 */
export function countProPayments(payments: ApprovedPaymentLike[] | null | undefined): number {
  if (!Array.isArray(payments)) return 0;
  return payments.filter((p) => {
    if (p?.status !== "approved") return false;
    if (p.transaction_amount === null || p.transaction_amount === undefined || p.transaction_amount === "") return true;
    const amount = typeof p.transaction_amount === "string" ? Number(p.transaction_amount) : p.transaction_amount;
    if (!Number.isFinite(amount)) return true;
    return amount >= PRO_MONTHLY_PRICE - 0.01;
  }).length;
}

function toTime(value: string | Date | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? fallback : t;
}

/**
 * Calcula o fim da vigência cumulativa Pro (subscriptions.current_period_end).
 *
 * Regra MAI-126: cada pagamento aprovado de R$ 12,90 adiciona 30 dias.
 * A âncora é max(primeiro pagamento aprovado, now) — garante reativação
 * com cobertura cheia mesmo quando pagamentos antigos expiraram, e mantém
 * idempotência (os mesmos pagamentos sempre geram o mesmo fim).
 *
 * @returns ISO string do current_period_end, ou null sem pagamentos válidos.
 */
export function calculateCumulativePeriodEnd(
  payments: ApprovedPaymentLike[] | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!Array.isArray(payments)) return null;
  const approved = payments.filter(
    (p) => p?.status === "approved" && isProAmount(p.transaction_amount),
  );
  if (approved.length === 0) return null;

  const times = approved.map((p) =>
    toTime(p.date_approved ?? p.date_created ?? null, now.getTime()),
  );
  const earliest = Math.min(...times);
  const anchor = Math.max(earliest, now.getTime());
  const totalDays = approved.length * DAYS_PER_PRO_PAYMENT;
  return new Date(anchor + totalDays * MS_PER_DAY).toISOString();
}

function isProAmount(value: number | string | null | undefined): boolean {
  if (value === null || value === undefined || value === "") return true;
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return true;
  return amount >= PRO_MONTHLY_PRICE - 0.01;
}

/** Dias restantes (ceil) entre now e um fim ISO. 0 quando expirado/inválido. */
export function proDaysRemainingUntil(currentPeriodEnd: string | Date | null | undefined, now: Date = new Date()): number {
  if (!currentPeriodEnd) return 0;
  const end = currentPeriodEnd instanceof Date ? currentPeriodEnd.getTime() : new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(end)) return 0;
  const diff = end - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / MS_PER_DAY);
}

/**
 * Formata "60 dias restantes (até 19/11/2026)" em pt-BR a partir de um fim ISO.
 * Retorna null quando não há vigência futura.
 */
export function formatProVigencia(
  currentPeriodEnd: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!currentPeriodEnd) return null;
  const end = new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) return null;
  const days = proDaysRemainingUntil(currentPeriodEnd, now);
  const date = end.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });
  const label = days === 1 ? "1 dia restante" : `${days} dias restantes`;
  return `${label} (até ${date})`;
}

/**
 * Retorna true quando o usuário pode criar/editar plantões:
 * trial vigente OU Pro ativa. Leitura do histórico permanece liberada.
 */
export function canCreateShift(trial: Pick<TrialInfo, "isExpired" | "isActive"> | null | undefined): boolean {
  if (!trial) return false;
  return trial.isActive || !trial.isExpired;
}

/**
 * Calculates remaining trial days and subscription state.
 *
 * Deriva a vigência Pro de `currentPeriodEnd` (subscriptions.current_period_end):
 * se now < currentPeriodEnd, a assinatura está ativa com dias restantes reais.
 *
 * @param createdAt ISO timestamp or Date of user registration (from auth.users.created_at)
 * @param subscriptionStatus Explicit subscription status override (e.g. 'active', 'pro')
 * @param now Reference timestamp for calculation (defaults to current date/time)
 * @param currentPeriodEnd Fim da vigência Pro cumulativa (ISO). Quando futuro, ativa o Pro.
 */
export function calculateTrial(
  createdAt: string | Date | null | undefined,
  subscriptionStatus?: string | null,
  now: Date = new Date(),
  currentPeriodEnd?: string | Date | null,
): TrialInfo {
  // 1. Vigência Pro cumulativa tem precedência (dados reais > status manual).
  if (currentPeriodEnd) {
    const endTime = currentPeriodEnd instanceof Date ? currentPeriodEnd.getTime() : new Date(currentPeriodEnd).getTime();
    if (!Number.isNaN(endTime)) {
      const endIso = new Date(endTime).toISOString();
      if (endTime > now.getTime()) {
        const daysRemaining = Math.max(1, Math.ceil((endTime - now.getTime()) / MS_PER_DAY));
        return {
          status: "active",
          daysRemaining,
          trialEndsAt: endIso,
          isTrialing: false,
          isExpired: false,
          isActive: true,
          totalDays: TRIAL_DURATION_DAYS,
          currentPeriodEnd: endIso,
          proDaysRemaining: daysRemaining,
          proEndsAt: endIso,
        };
      }
      // current_period_end expirado: cai para o fluxo de trial/status abaixo.
      // Se o status ainda disser "active" mas sem vigência futura, trata como expirado
      // (status financeiro sempre derivado dos dados reais — AGENTS.md).
      const expiredFallback = buildExpired(createdAt, now, endIso);
      const statusNormalized = subscriptionStatus?.trim().toLowerCase();
      if (
        statusNormalized === "active" ||
        statusNormalized === "pro" ||
        statusNormalized === "subscribed"
      ) {
        return expiredFallback;
      }
      return buildFromDates(createdAt, now, endIso);
    }
  }

  const statusNormalized = subscriptionStatus?.trim().toLowerCase();

  // If user has an active subscription (legado sem current_period_end)
  if (
    statusNormalized === "active" ||
    statusNormalized === "pro" ||
    statusNormalized === "subscribed"
  ) {
    const fallbackEnd = new Date(now.getTime() + DAYS_PER_PRO_PAYMENT * MS_PER_DAY).toISOString();
    return {
      status: "active",
      daysRemaining: DAYS_PER_PRO_PAYMENT,
      trialEndsAt: fallbackEnd,
      isTrialing: false,
      isExpired: false,
      isActive: true,
      totalDays: TRIAL_DURATION_DAYS,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd).toISOString() : null,
      proDaysRemaining: DAYS_PER_PRO_PAYMENT,
      proEndsAt: fallbackEnd,
    };
  }

  return buildFromDates(createdAt, now, null);
}

function emptyPro(): Pick<TrialInfo, "currentPeriodEnd" | "proDaysRemaining" | "proEndsAt"> {
  return { currentPeriodEnd: null, proDaysRemaining: 0, proEndsAt: null };
}

function buildExpired(
  createdAt: string | Date | null | undefined,
  now: Date,
  expiredEnd: string | null,
): TrialInfo {
  const created = createdAt ? new Date(createdAt) : now;
  const createdTime = isNaN(created.getTime()) ? now.getTime() : created.getTime();
  const trialEndsAt = new Date(createdTime + TRIAL_DURATION_DAYS * MS_PER_DAY).toISOString();
  return {
    status: "expired",
    daysRemaining: 0,
    trialEndsAt,
    isTrialing: false,
    isExpired: true,
    isActive: false,
    totalDays: TRIAL_DURATION_DAYS,
    currentPeriodEnd: expiredEnd,
    proDaysRemaining: 0,
    proEndsAt: null,
  };
}

function buildFromDates(
  createdAt: string | Date | null | undefined,
  now: Date,
  expiredEnd: string | null,
): TrialInfo {
  // Account creation fallback
  const created = createdAt ? new Date(createdAt) : now;
  const createdTime = isNaN(created.getTime()) ? now.getTime() : created.getTime();

  const trialEndsTime = createdTime + TRIAL_DURATION_DAYS * MS_PER_DAY;
  const trialEndsAt = new Date(trialEndsTime).toISOString();

  const diffMs = trialEndsTime - now.getTime();

  if (diffMs <= 0) {
    return {
      status: "expired",
      daysRemaining: 0,
      trialEndsAt,
      isTrialing: false,
      isExpired: true,
      isActive: false,
      totalDays: TRIAL_DURATION_DAYS,
      currentPeriodEnd: expiredEnd,
      proDaysRemaining: 0,
      proEndsAt: null,
    };
  }

  // Calculate days remaining (ceil so that during day 1 it says 14/13/..., last day says 1)
  const daysRemaining = Math.max(1, Math.min(TRIAL_DURATION_DAYS, Math.ceil(diffMs / MS_PER_DAY)));

  return {
    status: "trialing",
    daysRemaining,
    trialEndsAt,
    isTrialing: true,
    isExpired: false,
    isActive: false,
    totalDays: TRIAL_DURATION_DAYS,
    ...emptyPro(),
  };
}
