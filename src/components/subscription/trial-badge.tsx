"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "cn";
import { useSubscription } from "@/lib/subscription";

/**
 * Desktop sidebar trial badge with countdown and dynamic color tone.
 * Built to strictly stay within the 256px sidebar without horizontal overflow.
 */
export function TrialBadge({ className }: { className?: string }) {
  const { trial, isLoading } = useSubscription();

  if (isLoading) {
    return (
      <div className={cn("w-full px-1 py-1", className)}>
        <div className="h-7 w-full animate-pulse rounded-full bg-muted/60" />
      </div>
    );
  }

  if (!trial) return null;

  if (trial.isActive) {
    const vigEnd = trial.proEndsAt ?? trial.currentPeriodEnd ?? trial.trialEndsAt;
    const vigDate = (() => {
      try {
        return new Date(vigEnd).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });
      } catch {
        return null;
      }
    })();
    const vigFull =
      trial.proDaysRemaining > 0 && vigDate
        ? `Plano Pro Ativo — ${trial.proDaysRemaining === 1 ? "1 dia restante" : `${trial.proDaysRemaining} dias restantes`} (até ${vigDate})`
        : "Plano Pro Ativo";

    const vigShort =
      trial.proDaysRemaining > 0
        ? `Pro Ativo • ${trial.proDaysRemaining}d ${vigDate ? `(até ${vigDate.slice(0, 5)})` : ""}`
        : "Plano Pro Ativo";

    return (
      <Link
        href="/configuracoes"
        className={cn(
          "group flex w-full max-w-full min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 overflow-hidden",
          "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-500/20",
          className
        )}
        title={vigFull}
        aria-label={vigFull}
      >
        <Sparkles className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="font-semibold truncate min-w-0 flex-1">{vigShort}</span>
      </Link>
    );
  }

  if (trial.isExpired) {
    return (
      <Link
        href="/configuracoes"
        className={cn(
          "group flex w-full max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 overflow-hidden",
          "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 active:scale-[0.98]",
          className
        )}
        title="Seu período de teste terminou. Clique para assinar o MeuPlantão Pro."
      >
        <span className="shrink-0">⚠️</span>
        <span className="truncate min-w-0 flex-1">Trial expirado — Assinar</span>
      </Link>
    );
  }

  // Trialing status: 14 to 4 days vs 3 to 1 days
  const isWarning = trial.daysRemaining <= 3;
  const badgeLabel =
    trial.daysRemaining === 1
      ? "⏳ 1 dia restante"
      : isWarning
      ? `⏳ ${trial.daysRemaining} dias restantes`
      : `🌱 ${trial.daysRemaining} dias de teste`;

  return (
    <Link
      href="/configuracoes"
      className={cn(
        "group flex w-full max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 active:scale-[0.98] overflow-hidden",
        isWarning
          ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 border border-amber-500/25"
          : "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/25",
        className
      )}
      title={`Período de teste gratuito: ${trial.daysRemaining} dias restantes. Clique para ver o plano.`}
    >
      <span className="truncate min-w-0 flex-1 font-medium">{badgeLabel}</span>
    </Link>
  );
}

/**
 * Mobile header compact badge with high touch accessibility.
 */
export function TrialBadgeMobile({ className }: { className?: string }) {
  const { trial, isLoading } = useSubscription();

  if (isLoading) {
    return (
      <div className={cn("flex items-center pr-1", className)}>
        <div className="h-7 w-16 animate-pulse rounded-full bg-muted/60" />
      </div>
    );
  }

  if (!trial) return null;

  if (trial.isActive) {
    const vigEnd = trial.proEndsAt ?? trial.currentPeriodEnd ?? trial.trialEndsAt;
    const vigShort = (() => {
      try {
        const d = new Date(vigEnd).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });
        return trial.proDaysRemaining > 0 ? `Pro • ${trial.proDaysRemaining}d (até ${d})` : "Pro";
      } catch {
        return "Pro";
      }
    })();
    const vigTitle =
      trial.proDaysRemaining > 0
        ? `Plano Pro Ativo — ${trial.proDaysRemaining} dias restantes`
        : "Plano Pro Ativo";
    return (
      <Link
        href="/configuracoes"
        className={cn(
          "inline-flex min-h-[36px] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
          "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/20",
          className
        )}
        title={vigTitle}
        aria-label={vigTitle}
      >
        <Sparkles className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span className="truncate max-w-[150px]">{vigShort}</span>
      </Link>
    );
  }

  if (trial.isExpired) {
    return (
      <Link
        href="/configuracoes"
        className={cn(
          "inline-flex min-h-[36px] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold transition-transform active:scale-95",
          "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30",
          className
        )}
        title="Trial expirado - clique para assinar"
        aria-label="Trial expirado - assinar plano Pro"
      >
        <span>⚠️ Assinar</span>
      </Link>
    );
  }

  const isWarning = trial.daysRemaining <= 3;
  const mobileLabel = isWarning ? `⏳ ${trial.daysRemaining}d` : `🌱 ${trial.daysRemaining}d`;

  return (
    <Link
      href="/configuracoes"
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors active:scale-95",
        isWarning
          ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 border border-amber-500/25"
          : "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/25",
        className
      )}
      title={`Teste: ${trial.daysRemaining} dias restantes`}
      aria-label={`Teste: ${trial.daysRemaining} dias restantes`}
    >
      <span>{mobileLabel}</span>
    </Link>
  );
}
