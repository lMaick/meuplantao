export type SubscriptionStatus = "trialing" | "expired" | "active";

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
