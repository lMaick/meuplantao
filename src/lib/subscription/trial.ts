import type { TrialInfo } from "./types";

export const TRIAL_DURATION_DAYS = 14;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculates remaining trial days and subscription state based on account creation date (created_at).
 *
 * @param createdAt ISO timestamp or Date of user registration (from auth.users.created_at)
 * @param subscriptionStatus Explicit subscription status override (e.g. 'active', 'pro')
 * @param now Reference timestamp for calculation (defaults to current date/time)
 */
export function calculateTrial(
  createdAt: string | Date | null | undefined,
  subscriptionStatus?: string | null,
  now: Date = new Date()
): TrialInfo {
  const statusNormalized = subscriptionStatus?.trim().toLowerCase();

  // If user has an active subscription
  if (
    statusNormalized === "active" ||
    statusNormalized === "pro" ||
    statusNormalized === "subscribed"
  ) {
    return {
      status: "active",
      daysRemaining: 0,
      trialEndsAt: new Date(now.getTime() + 30 * MS_PER_DAY).toISOString(),
      isTrialing: false,
      isExpired: false,
      isActive: true,
      totalDays: TRIAL_DURATION_DAYS,
    };
  }

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
  };
}
