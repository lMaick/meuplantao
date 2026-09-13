"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DashboardAlertsSummary } from "@/lib/dashboard/alerts";
import { ALL_PLACES } from "@/lib/finance-filters";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function DashboardAlerts({
  summary,
  placeId = ALL_PLACES,
}: {
  summary: DashboardAlertsSummary;
  placeId?: string;
}) {
  if (!summary.hasAlerts) return null;

  const hasOverdue = summary.overdueCount > 0;
  const overdueHref =
    placeId && placeId !== ALL_PLACES
      ? `/pagamentos?filter=atrasados&period=all&placeId=${encodeURIComponent(placeId)}`
      : "/pagamentos?filter=atrasados&period=all";

  const upcomingHref =
    placeId && placeId !== ALL_PLACES
      ? `/pagamentos?filter=a-vencer&period=all&placeId=${encodeURIComponent(placeId)}`
      : "/pagamentos?filter=a-vencer&period=all";

  if (hasOverdue) {
    return (
      <section
        role="region"
        aria-label="Alertas de repasses financeiros em atraso"
        className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 shadow-sm text-foreground transition-all"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-destructive/15 p-2.5 text-destructive shrink-0">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive" dot>
                  Atenção · Repasses em atraso
                </Badge>
                {summary.upcomingCount > 0 && (
                  <Badge variant="warning">
                    +{summary.upcomingCount} a vencer em 7 dias
                  </Badge>
                )}
              </div>
              <h2 className="text-xl font-bold tracking-tight text-destructive">
                Você tem {money.format(summary.overdueAmount)} em atraso
              </h2>
              <p className="text-sm font-medium text-destructive/90">
                {summary.overdueCount} {summary.overdueCount === 1 ? "plantão realizado está" : "plantões realizados estão"} com repasse vencido.
              </p>
              {summary.topOverdue && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Maior pendência: <strong className="font-semibold text-foreground">{summary.topOverdue.responsibleName}</strong> ·{" "}
                  {money.format(summary.topOverdue.balance)} ({summary.topOverdue.daysOverdue}{" "}
                  {summary.topOverdue.daysOverdue === 1 ? "dia" : "dias"} em atraso)
                </p>
              )}
            </div>
          </div>

          <div className="pt-2 sm:pt-0 shrink-0">
            <Link
              href={overdueHref}
              className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:ring-3 focus-visible:ring-destructive/50 transition-colors"
            >
              Cobrar atrasados
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // Alerta preventivo (vencimentos nos próximos 7 dias sem nenhum atraso ativo)
  return (
    <section
      role="region"
      aria-label="Alerta preventivo de repasses a vencer nos próximos 7 dias"
      className="rounded-2xl border border-warning/30 bg-warning/10 p-5 shadow-sm text-foreground transition-all"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="rounded-xl bg-warning/20 p-2.5 text-warning-foreground shrink-0">
            <CalendarClock className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="warning" dot>
                Preventivo · Próximos 7 dias
              </Badge>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-warning-foreground">
              {money.format(summary.upcomingAmount)} a receber nos próximos 7 dias
            </h2>
            <p className="text-sm font-medium text-warning-foreground/90">
              {summary.upcomingCount} {summary.upcomingCount === 1 ? "plantão realizado tem" : "plantões realizados têm"} repasse previsto para esta semana.
            </p>
            {summary.topUpcoming && (
              <p className="pt-1 text-xs text-muted-foreground">
                Próximo repasse: <strong className="font-semibold text-foreground">{summary.topUpcoming.responsibleName}</strong> ·{" "}
                {money.format(summary.topUpcoming.balance)} (
                {summary.topUpcoming.daysUntilDue === 0
                  ? "vence hoje"
                  : `vence em ${summary.topUpcoming.daysUntilDue} ${summary.topUpcoming.daysUntilDue === 1 ? "dia" : "dias"}`}
                )
              </p>
            )}
          </div>
        </div>

        <div className="pt-2 sm:pt-0 shrink-0">
          <Link
            href={upcomingHref}
            className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-warning px-5 py-2.5 text-sm font-semibold text-warning-foreground shadow-sm hover:bg-warning/90 focus-visible:ring-3 focus-visible:ring-warning/50 transition-colors"
          >
            Ver agenda
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
