"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "cn";
import { useSubscription } from "@/lib/subscription";

/**
 * Desktop sidebar trial badge with countdown and dynamic color tone.
 */
export function TrialBadge({ className }: { className?: string }) {
  const { trial, isLoading } = useSubscription();

  if (isLoading) {
    return (
      <div className={cn("px-3 py-1.5", className)}>
        <div className="h-7 w-full max-w-[190px] animate-pulse rounded-full bg-muted/60" />
      </div>
    );
  }

  if (!trial) return null;

  if (trial.isActive) {
    return (
      <Link
        href="/configuracoes"
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200",
          "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-500/20",
          className
        )}
        title="Assinatura Pro ativa"
      >
        <Sparkles className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="font-semibold">Plano Pro Ativo</span>
      </Link>
    );
  }

  if (trial.isExpired) {
    return (
      <Link
        href="/configuracoes"
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all duration-200",
          "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 active:scale-[0.98]",
          className
        )}
        title="Seu período de teste terminou. Clique para assinar o MeuPlantão Pro."
      >
        <span>⚠️</span>
        <span>Trial expirado — Assinar</span>
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
        "group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 active:scale-[0.98]",
        isWarning
          ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400 border border-amber-500/25"
          : "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/25",
        className
      )}
      title={`Período de teste gratuito: ${trial.daysRemaining} dias restantes. Clique para ver o plano.`}
    >
      <span className="truncate font-medium">{badgeLabel}</span>
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
    return (
      <Link
        href="/configuracoes"
        className={cn(
          "inline-flex min-h-[36px] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
          "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/20",
          className
        )}
        title="Plano Pro Ativo"
        aria-label="Plano Pro Ativo"
      >
        <Sparkles className="size-3 text-emerald-600 dark:text-emerald-400" />
        <span>Pro</span>
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
