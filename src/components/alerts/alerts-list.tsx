"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeletons";
import { listAlerts, type Alert } from "@/lib/alerts";

export function AlertsList() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAlerts()
      .then(setAlerts)
      .catch(() => setError("Não foi possível carregar seus alertas."));
  }, []);

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!alerts) {
    return (
      <div role="status" aria-label="Carregando alertas..." className="space-y-3">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Tudo em dia"
        description="Não há atrasos ou plantões nos próximos 7 dias."
        action={
          <Link
            href="/calendario"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
          >
            Ver calendário
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3" role="feed" aria-label="Lista de alertas">
      {alerts.map((alert) => {
        const isAtraso = alert.kind === "atraso";
        return (
          <article
            key={alert.id}
            className={`flex flex-col gap-4 rounded-2xl border p-4 shadow-xs transition-colors sm:flex-row sm:items-center sm:justify-between sm:p-5 ${
              isAtraso
                ? "border-destructive/30 bg-card hover:border-destructive/50"
                : "border-warning/30 bg-card hover:border-warning/50"
            }`}
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div
                className={`mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl ${
                  isAtraso
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/20 text-warning-foreground"
                }`}
              >
                {isAtraso ? (
                  <AlertCircle className="size-5" aria-hidden="true" />
                ) : (
                  <CalendarClock className="size-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={isAtraso ? "destructive" : "warning"} dot>
                    {isAtraso ? "Recebimento em atraso" : "Próximo plantão"}
                  </Badge>
                </div>
                <h2 className="text-base font-semibold text-foreground truncate">{alert.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{alert.description}</p>
              </div>
            </div>

            <div className="shrink-0 pt-2 sm:pt-0">
              {isAtraso ? (
                <Link
                  href="/pagamentos?filter=atrasados"
                  className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-3 focus-visible:ring-destructive/40 transition-colors"
                >
                  Cobrar repasse
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <Link
                  href={`/calendario/plantao/${alert.shift.id}`}
                  className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground shadow-xs hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors"
                >
                  Ver plantão
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
