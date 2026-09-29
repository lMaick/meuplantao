import {
  CANONICAL_PLANS,
  SUBSCRIPTION_PERIODS,
  type CanonicalPlan,
  type SubscriptionMonths,
} from "@/lib/mercadopago/payments";

export type SubscriptionStatus = "trialing" | "expired" | "active";

export { SUBSCRIPTION_PERIODS, type SubscriptionMonths };
export type SubscriptionPeriod = CanonicalPlan;

export const SUBSCRIPTION_PERIODS_CONFIG: readonly SubscriptionPeriod[] = CANONICAL_PLANS;

export function getSubscriptionPeriod(months: number): SubscriptionPeriod | undefined {
  return CANONICAL_PLANS.find((period) => period.months === months);
}

export function addSubscriptionValidity(start: Date, validityDays: number): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + validityDays);
  return end;
}

export interface TrialInfo {
  status: SubscriptionStatus;
  daysRemaining: number;
  trialEndsAt: string;
  isTrialing: boolean;
  isExpired: boolean;
  isActive: boolean;
  totalDays: number;
  /** Fim da vigência Pro cumulativa (subscriptions.current_period_end). Null quando sem Pro. */
  currentPeriodEnd: string | null;
  /** Dias restantes de Pro derivados de currentPeriodEnd. 0 quando sem Pro ativa. */
  proDaysRemaining: number;
  /** Data limite ISO da vigência Pro. Null quando sem Pro ativa. */
  proEndsAt: string | null;
}
