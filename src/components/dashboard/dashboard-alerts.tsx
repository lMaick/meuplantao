"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
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
  const overdueHref = placeId && placeId !== ALL_PLACES
    ? `/pagamentos?filter=atrasados&period=all&placeId=${encodeURIComponent(placeId)}`
    : "/pagamentos?filter=atrasados&period=all";

  const upcomingHref = placeId && placeId !== ALL_PLACES
    ? `/pagamentos?filter=a-vencer&period=all&placeId=${encodeURIComponent(placeId)}`
    : "/pagamentos?filter=a-vencer&period=all";

  if (hasOverdue) {
    return (
      <section
        role="region"
        aria-label="Alertas de repasses financeiros em atraso"
        className="rounded-2xl border border-rose-200 bg-rose-50/90 p-5 shadow-sm text-rose-950 transition-all"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-rose-100 p-2.5 text-rose-600 shrink-0">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-rose-200/80 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
                  Atenção · Repasses em atraso
                </span>
                {summary.upcomingCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    +{summary.upcomingCount} a vencer em 7 dias
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold tracking-tight text-rose-900">
                Você tem {money.format(summary.overdueAmount)} em atraso
              </h2>
              <p className="text-sm text-rose-800">
                {summary.overdueCount} {summary.overdueCount === 1 ? "plantão realizado está" : "plantões realizados estão"} com repasse vencido.
              </p>
              {summary.topOverdue && (
                <p className="pt-1 text-xs text-rose-700">
                  Maior pendência: <strong className="font-semibold text-rose-900">{summary.topOverdue.responsibleName}</strong> ·{" "}
                  {money.format(summary.topOverdue.balance)} ({summary.topOverdue.daysOverdue}{" "}
                  {summary.topOverdue.daysOverdue === 1 ? "dia" : "dias"} em atraso)
                </p>
              )}
            </div>
          </div>

          <div className="pt-2 sm:pt-0 shrink-0">
            <Link
              href={overdueHref}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 transition-colors"
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
      className="rounded-2xl border border-amber-200 bg-amber-50/90 p-5 shadow-sm text-amber-950 transition-all"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="rounded-xl bg-amber-100 p-2.5 text-amber-700 shrink-0">
            <CalendarClock className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Preventivo · Próximos 7 dias
              </span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-amber-900">
              {money.format(summary.upcomingAmount)} a receber nos próximos 7 dias
            </h2>
            <p className="text-sm text-amber-800">
              {summary.upcomingCount} {summary.upcomingCount === 1 ? "plantão realizado tem" : "plantões realizados têm"} repasse previsto para esta semana.
            </p>
            {summary.topUpcoming && (
              <p className="pt-1 text-xs text-amber-700">
                Próximo repasse: <strong className="font-semibold text-amber-900">{summary.topUpcoming.responsibleName}</strong> ·{" "}
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
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 transition-colors"
          >
            Acompanhar a vencer
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
