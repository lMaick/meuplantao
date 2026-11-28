"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { getEmailAlertsEnabled, setEmailAlertsEnabled } from "@/lib/notifications/preferences";

type State = { status: "loading" } | { status: "ready"; enabled: boolean; saving: boolean } | { status: "error" };

export function EmailAlertsToggle() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getEmailAlertsEnabled()
      .then((enabled) => active && setState({ status: "ready", enabled, saving: false }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, []);

  async function toggle() {
    if (state.status !== "ready" || state.saving) return;
    const next = !state.enabled;
    setMessage(null);
    setState({ status: "ready", enabled: next, saving: true });
    try {
      const saved = await setEmailAlertsEnabled(next);
      setState({ status: "ready", enabled: saved, saving: false });
    } catch {
      setState({ status: "ready", enabled: !next, saving: false });
      setMessage("Não deu pra salvar agora. Tente de novo.");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p id="email-alerts-label" className="text-sm font-semibold text-foreground">Avisos por e-mail</p>
          <p id="email-alerts-hint" className="text-xs text-muted-foreground">
            Aviso quando um repasse passa da data prevista e um resumo toda segunda-feira.
          </p>
        </div>
        {state.status === "loading" ? (
          <Skeleton className="h-11 w-14 shrink-0 rounded-full" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={state.status === "ready" && state.enabled}
            aria-labelledby="email-alerts-label"
            aria-describedby="email-alerts-hint"
            disabled={state.status !== "ready" || state.saving}
            onClick={toggle}
            className="group flex h-11 min-h-[44px] w-14 min-w-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              className={cn(
                "relative block h-7 w-12 rounded-full border border-border/70 transition-colors duration-200 motion-reduce:transition-none",
                state.status === "ready" && state.enabled ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 block size-5 rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none",
                  state.status === "ready" && state.enabled ? "translate-x-5" : "translate-x-0",
                )}
              />
            </span>
          </button>
        )}
      </div>
      <p className="min-h-4 text-xs text-destructive" role="status" aria-live="polite">
        {state.status === "error" ? "Não consegui carregar essa preferência agora." : message}
      </p>
    </div>
  );
}
