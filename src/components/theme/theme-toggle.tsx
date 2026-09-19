"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { getNextTheme, themeOptions, type Theme } from "./theme-utils";
import { useTheme } from "./theme-provider";

const themeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const themeLabels = {
  light: "Claro",
  dark: "Escuro",
  system: "Sistema",
} as const;

export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, resolvedTheme, mounted, setTheme } = useTheme();
  const activeTheme = mounted ? theme : "system";
  const ActiveIcon = themeIcons[activeTheme];
  const activeLabel = themeLabels[activeTheme];

  if (compact) {
    const nextTheme = getNextTheme(activeTheme);
    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn("rounded-xl text-muted-foreground hover:text-foreground", className)}
        aria-label={`Tema ${activeLabel}. Alternar para ${themeLabels[nextTheme]}`}
        title={`Tema: ${activeLabel}`}
        onClick={() => setTheme(nextTheme)}
      >
        <ActiveIcon className="size-5 transition-transform duration-200" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div>
        <p className="text-sm font-semibold text-foreground">Aparência</p>
        <p className="mt-1 text-xs text-muted-foreground">Escolha como o MeuPlantao aparece para você.</p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema da interface">
        {themeOptions.map(({ value, label }) => {
          const Icon = themeIcons[value];
          const selected = mounted && theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn(
                "flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => setTheme(value as Theme)}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {mounted && theme === "system" ? `Seguindo o sistema (${resolvedTheme === "dark" ? "escuro" : "claro"}).` : `Tema ${activeLabel.toLowerCase()} selecionado.`}
      </p>
    </div>
  );
}
