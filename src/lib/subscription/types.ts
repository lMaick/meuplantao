export type SubscriptionStatus = "trialing" | "expired" | "active";

export const SUBSCRIPTION_PERIODS = [1, 3, 6, 12] as const;
export type SubscriptionMonths = (typeof SUBSCRIPTION_PERIODS)[number];

export interface SubscriptionPeriod {
  months: SubscriptionMonths;
  label: string;
  price: number;
  validityDays: number;
  monthlyEquivalent: number;
  badge?: string;
}

export const SUBSCRIPTION_PERIODS_CONFIG: readonly SubscriptionPeriod[] = [
  { months: 1, label: "Mensal", price: 12.9, validityDays: 30, monthlyEquivalent: 12.9 },
  { months: 3, label: "Trimestral", price: 38.7, validityDays: 90, monthlyEquivalent: 12.9 },
  { months: 6, label: "Semestral", price: 69.9, validityDays: 180, monthlyEquivalent: 11.65, badge: "Mais escolhido" },
  { months: 12, label: "Anual", price: 129.9, validityDays: 365, monthlyEquivalent: 10.825, badge: "Melhor valor · 2 meses grátis" },
] as const;

export function getSubscriptionPeriod(months: number): SubscriptionPeriod | undefined {
  return SUBSCRIPTION_PERIODS_CONFIG.find((period) => period.months === months);
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
