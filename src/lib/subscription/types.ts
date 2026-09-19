export type SubscriptionStatus = "trialing" | "expired" | "active";

export interface TrialInfo {
  status: SubscriptionStatus;
  daysRemaining: number;
  trialEndsAt: string;
  isTrialing: boolean;
  isExpired: boolean;
  isActive: boolean;
  totalDays: number;
}
