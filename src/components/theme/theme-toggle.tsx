"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { getToggledTheme, themeOptions, type Theme } from "./theme-utils";
import { useTheme } from "./theme-provider";

const themeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, resolvedTheme, mounted, setTheme } = useTheme();
  const currentResolved = mounted ? resolvedTheme : "light";

  if (compact) {
    const nextTheme = getToggledTheme(theme, currentResolved);
    const isDark = currentResolved === "dark";
    const ActiveIcon = isDark ? Moon : Sun;
    const label = isDark ? "Alternar para modo claro" : "Alternar para modo escuro";

    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "size-11 min-h-[44px] min-w-[44px] rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 transition-colors",
          className
        )}
        aria-label={label}
        title={label}
        onClick={() => setTheme(nextTheme)}
      >
        <ActiveIcon className="size-5 transition-transform duration-200" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Tema da Interface</p>
          <p className="text-xs text-muted-foreground">Escolha a aparência visual do aplicativo.</p>
        </div>
        <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {mounted && theme === "system"
            ? `Sistema (${resolvedTheme === "dark" ? "escuro" : "claro"})`
            : mounted && theme === "dark"
            ? "Escuro ativo"
            : "Claro ativo"}
        </span>
      </div>
      <div
        className="grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-muted/60 p-1"
        role="radiogroup"
        aria-label="Tema da interface"
      >
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
                "flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selected
                  ? "border border-border/40 bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-background/40 hover:text-foreground"
              )}
              onClick={() => setTheme(value as Theme)}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
