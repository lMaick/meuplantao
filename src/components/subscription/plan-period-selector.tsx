"use client";

import { Check } from "lucide-react";
import { cn } from "cn";
import { SUBSCRIPTION_PERIODS_CONFIG, type SubscriptionMonths } from "@/lib/subscription/types";

interface PlanPeriodSelectorProps {
  value: SubscriptionMonths;
  onChange: (months: SubscriptionMonths) => void;
  disabled?: boolean;
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function PlanPeriodSelector({ value, onChange, disabled = false }: PlanPeriodSelectorProps) {
  return (
    <fieldset className="mt-6 space-y-3" disabled={disabled}>
      <legend className="text-sm font-semibold text-foreground">Escolha seu período de contratação</legend>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="radiogroup" aria-label="Período de contratação">
        {SUBSCRIPTION_PERIODS_CONFIG.map((period) => {
          const selected = period.months === value;
          return (
            <label
              key={period.months}
              className={cn(
                "relative flex min-h-[112px] cursor-pointer flex-col justify-between rounded-xl border p-3 transition-[border-color,background-color,box-shadow] duration-200 motion-reduce:transition-none",
                "focus-within:ring-2 focus-within:ring-emerald-600 focus-within:ring-offset-2",
                selected ? "border-emerald-600 bg-emerald-500/10 shadow-sm shadow-emerald-700/10" : "border-border/80 bg-background hover:border-emerald-500/60",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input type="radio" name="subscription-period" value={period.months} checked={selected} onChange={() => onChange(period.months)} className="sr-only" />
              <span className="flex items-start justify-between gap-2">
                <span><span className="block text-sm font-bold text-foreground">{period.months} {period.months === 1 ? "mês" : "meses"}</span><span className="mt-0.5 block text-xs text-muted-foreground">{period.label}</span></span>
                {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />}
              </span>
              <span><span className="block font-mono text-base font-bold tabular-nums text-foreground">{currency.format(period.price)}</span><span className="block text-[11px] text-muted-foreground">{currency.format(period.monthlyEquivalent)}/mês</span></span>
              {period.badge && <span className="absolute -top-2 left-2 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">{period.badge}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
