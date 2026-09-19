"use client";
/* eslint-disable react-hooks/set-state-in-effect -- initial data load is asynchronous */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Calendar,
  CalendarDays,
  CircleAlert,
  Hospital,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  WalletCards,
} from "lucide-react";
import { listContacts, type Contact } from "@/lib/contacts";
import { listPlaces, type Place } from "@/lib/places";
import { listPayments, type Payment } from "@/lib/payments";
import { listShifts, type Shift } from "@/lib/shifts";
import { isOverdue, listObligations, type Obligation } from "@/lib/obligations";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardSkeleton } from "@/components/ui/skeletons";
import { FinanceFilters } from "@/components/finance/finance-filters";
import {
  ALL_PLACES,
  currentMonthValue,
  matchesPeriod,
  matchesPlace,
  matchesShift,
  receivedLabel,
} from "@/lib/finance-filters";
import { computeDashboardAlerts } from "@/lib/dashboard/alerts";
import { DashboardAlerts } from "@/components/dashboard/dashboard-alerts";
import { cn } from "cn";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const bahiaDate = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(value);

export function Dashboard() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(() => currentMonthValue());
  const [placeId, setPlaceId] = useState<string>(ALL_PLACES);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextShifts, nextPayments, nextObligations, nextPlaces, nextContacts] =
        await Promise.all([
          listShifts(),
          listPayments(),
          listObligations(),
          listPlaces(),
          listContacts(),
        ]);
      setShifts(nextShifts);
      setPayments(nextPayments);
      setObligations(nextObligations);
      setPlaces(nextPlaces);
      setContacts(nextContacts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setOnboardingDismissed(window.localStorage.getItem("meuplantao:onboarding-dismissed") === "true");
    setOnboardingReady(true);
  }, []);

  function dismissOnboarding() {
    window.localStorage.setItem("meuplantao:onboarding-dismissed", "true");
    setOnboardingDismissed(true);
  }

  const alertsSummary = useMemo(() => {
    return computeDashboardAlerts({
      shifts,
      obligations,
      places,
      contacts,
      placeId,
    });
  }, [shifts, obligations, places, contacts, placeId]);

  const data = useMemo(() => {
    const today = bahiaDate();
    const end = new Date(`${today}T12:00:00-03:00`);
    end.setDate(end.getDate() + 7);
    const endIso = bahiaDate(end);
    const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
    const obligationById = new Map(obligations.map((obligation) => [obligation.id, obligation]));
    const placesById = new Map(places.map((place) => [place.id, place.nome]));
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact.nome]));
    const filteredShifts = shifts.filter((shift) => matchesShift(shift, period, placeId));
    const realized = new Set(
      filteredShifts.filter((shift) => shift.status === "realizado").map((shift) => shift.id)
    );
    const financial = obligations.filter(
      (obligation) => realized.has(obligation.shift_id) && obligation.valor_devido !== null
    );
    const pending = financial
      .filter((obligation) => Number(obligation.saldo ?? 0) > 0)
      .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista))
      .slice(0, 4);

    return {
      due: financial.reduce(
        (sum, obligation) => sum + Math.max(0, Number(obligation.saldo ?? 0)),
        0
      ),
      received: payments
        .filter((payment) => {
          if (payment.status !== "registrado") return false;
          if (!matchesPeriod(payment.data_pagamento, period)) return false;
          if (placeId === ALL_PLACES) return true;
          const obligation = obligationById.get(payment.obligation_id);
          const shift = obligation ? shiftsById.get(obligation.shift_id) : undefined;
          return shift ? matchesPlace(shift.place_id, placeId) : false;
        })
        .reduce((sum, payment) => sum + Number(payment.valor), 0),
      overdue: financial
        .filter(
          (obligation) => Number(obligation.saldo ?? 0) > 0 && isOverdue(obligation.data_prevista)
        )
        .reduce((sum, obligation) => sum + Number(obligation.saldo ?? 0), 0),
      pending,
      shiftsById,
      placesById,
      contactsById,
      upcoming: shifts
        .filter(
          (shift) =>
            shift.status === "agendado" &&
            shift.data >= today &&
            shift.data <= endIso &&
            matchesPlace(shift.place_id, placeId)
        )
        .sort((a, b) => `${a.data}${a.hora_inicio}`.localeCompare(`${b.data}${b.hora_inicio}`))
        .slice(0, 5),
    };
  }, [contacts, obligations, payments, places, shifts, period, placeId]);

  const responsible = (obligation: Obligation) =>
    obligation.responsavel_place_id
      ? data.placesById.get(obligation.responsavel_place_id)
      : obligation.responsavel_contact_id
        ? data.contactsById.get(obligation.responsavel_contact_id)
        : undefined;

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive">
          <CircleAlert className="size-6" />
        </div>
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {error}
        </p>
        <Button variant="outline" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </main>
    );
  }

  const kpis = [
    ["A receber", data.due, WalletCards],
    [receivedLabel(period), data.received, ArrowDownToLine],
    ["Em atraso", data.overdue, CircleAlert],
    ["Próximos 7 dias", data.upcoming.length, CalendarDays],
  ] as const;

  return (
    <main className="min-h-screen w-full max-w-full min-w-0 overflow-x-hidden bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              <span>Painel de Conciliação</span>
            </div>
            <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">Resumo financeiro</h1>
            <p className="mt-1 text-sm sm:text-base text-muted-foreground">Uma visão clara do que você tem para receber.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} className="min-h-[44px] rounded-xl font-medium border-border/80 shadow-xs hover:border-primary/40">
            <RefreshCw className="mr-2 size-4" />
            Atualizar
          </Button>
        </header>

        <nav className="flex flex-wrap gap-3">
          <Link
            href="/locais"
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "min-h-[44px] rounded-xl px-5 font-semibold shadow-xs border-border/80 hover:border-primary/40 hover:bg-muted/40 transition-all"
            )}
          >
            Locais de trabalho
          </Link>
          <Link
            href="/calendario"
            className={cn(
              buttonVariants({ variant: "default", size: "default" }),
              "min-h-[44px] rounded-xl px-5 font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md shadow-emerald-700/20 hover:from-emerald-500 hover:to-teal-500 hover:shadow-lg hover:shadow-emerald-700/30 transition-all"
            )}
          >
            <Calendar className="mr-2 size-4" />
            Calendário e novo plantão
          </Link>
        </nav>

        <FinanceFilters
          period={period}
          placeId={placeId}
          places={places}
          onPeriodChange={setPeriod}
          onPlaceChange={setPlaceId}
        />

        {onboardingReady && !onboardingDismissed && shifts.length === 0 && places.length === 0 && (
          <section
            aria-labelledby="first-value-title"
            className="motion-success relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-xs sm:p-6"
          >
            <button
              type="button"
              onClick={dismissOnboarding}
              className="absolute right-3 top-3 min-h-[44px] rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Explorar sozinho
            </button>
            <div className="max-w-2xl pr-24">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Primeiro passo · 1 de 2</p>
              <h2 id="first-value-title" className="mt-1.5 text-xl font-bold tracking-tight text-foreground">
                Vamos registrar seu primeiro plantão?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Comece cadastrando o hospital ou local onde você trabalha. Em seguida, informe um plantão para acompanhar o valor previsto e o saldo a receber.
              </p>
              <Link
                href="/locais"
                className={cn(buttonVariants({ variant: "default", size: "default" }), "mt-4 min-h-[44px] rounded-xl")}
              >
                <Hospital className="mr-2 size-4" />
                Cadastrar primeiro local
              </Link>
            </div>
          </section>
        )}

        <DashboardAlerts summary={alertsSummary} placeId={placeId} />

        <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(([label, value, Icon]) => {
            const isOverdueKpi = label === "Em atraso" && Number(value) > 0;
            const isReceivedKpi = label.startsWith("Recebido");
            const isUpcomingKpi = label === "Próximos 7 dias";
            return (
              <StatCard
                key={label}
                label={label}
                value={
                  <span className="flex items-center justify-between">
                    <span className={cn(isOverdueKpi ? "text-destructive" : "text-foreground")}>
                      {label === "Próximos 7 dias" ? value : money.format(Number(value))}
                    </span>
                    <span
                      className={cn(
                        "rounded-xl p-2 shadow-xs",
                        isOverdueKpi
                          ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20"
                          : isReceivedKpi
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20"
                            : isUpcomingKpi
                              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/20"
                              : "bg-primary/10 text-primary ring-1 ring-primary/20"
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                  </span>
                }
              />
            );
          })}
        </section>

        <section className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="p-4 shadow-xs sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5 text-primary">
                  <ArrowUpRight className="size-5" />
                </div>
                <h2 className="font-bold tracking-tight text-foreground">Recebimentos pendentes</h2>
              </div>
              {data.pending.length > 0 && (
                <Link
                  href="/pagamentos"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Ver todos
                </Link>
              )}
            </div>

            {data.pending.length > 0 ? (
              <div className="divide-y divide-border">
                {data.pending.map((obligation) => {
                  const shift = data.shiftsById.get(obligation.shift_id);
                  const balance = Number(obligation.saldo ?? 0);
                  const overdue = balance > 0 && isOverdue(obligation.data_prevista);
                  return (
                    <div className="flex flex-col items-stretch gap-3 rounded-xl px-3 py-3.5 transition-all hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:-mx-1" key={obligation.id}>
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary ring-1 ring-primary/20 shrink-0">
                          <Hospital className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">
                            {responsible(obligation) ??
                              (shift ? data.placesById.get(shift.place_id) : undefined) ??
                              "Responsável não informado"}
                          </p>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                            Previsto para {date.format(new Date(`${obligation.data_prevista}T12:00:00`))} ·{" "}
                            <span className="font-mono font-bold text-foreground">{money.format(balance)}</span>
                          </p>
                          <div className="mt-1.5">
                            <Badge variant={overdue ? "destructive" : "warning"} dot>
                              {overdue ? "Atrasado" : "A vencer"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Link
                        href={`/calendario/plantao/${shift?.id ?? obligation.shift_id}`}
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "w-full text-primary hover:bg-primary/10 hover:text-primary font-semibold min-h-[44px] rounded-xl sm:w-auto sm:shrink-0"
                        )}
                      >
                        Ver plantão
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                compact
                icon={WalletCards}
                title="Nenhum valor pendente"
                description="Todos os seus plantões realizados estão quitados ou sem pendências financeiras."
                action={
                  <Link
                    href="/calendario?novo=1"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-[44px] rounded-xl")}
                  >
                    <Calendar className="mr-1.5 size-4" />
                    Cadastrar plantão
                  </Link>
                }
              />
            )}
          </Card>

          <Card className="p-4 shadow-xs sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5 text-primary">
                  <CalendarDays className="size-5" />
                </div>
                <h2 className="font-bold tracking-tight text-foreground">Próximos 7 dias</h2>
              </div>
              {data.upcoming.length > 0 && (
                <Link
                  href="/calendario"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Ver agenda
                </Link>
              )}
            </div>

            {data.upcoming.length > 0 ? (
              <div className="divide-y divide-border">
                {data.upcoming.map((shift) => {
                  const isNight = shift.hora_inicio >= "18:00" || shift.hora_inicio < "06:00";
                  return (
                    <div className="flex flex-col items-stretch gap-3 rounded-xl px-3 py-3.5 transition-all hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:-mx-1" key={shift.id}>
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary ring-1 ring-primary/20 shrink-0">
                          <Hospital className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">
                            {data.placesById.get(shift.place_id) ?? "Local não informado"}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground mt-0.5">
                            <span>
                              {date.format(new Date(`${shift.data}T12:00:00`))} · {shift.hora_inicio.slice(0, 5)}–
                              {shift.hora_fim.slice(0, 5)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
                              {isNight ? (
                                <Moon className="size-3 text-indigo-500" />
                              ) : (
                                <Sun className="size-3 text-amber-500" />
                              )}
                              <span>{isNight ? "Noturno" : "Diurno"}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <Link
                        href={`/calendario/plantao/${shift.id}`}
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "w-full text-primary hover:bg-primary/10 hover:text-primary font-semibold min-h-[44px] rounded-xl sm:w-auto sm:shrink-0"
                        )}
                      >
                        Abrir plantão
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                compact
                icon={CalendarDays}
                title="Nenhum plantão agendado"
                description="Você não possui plantões marcados para os próximos 7 dias."
                action={
                  <Link
                    href="/calendario?novo=1"
                    className={cn(buttonVariants({ variant: "default", size: "sm" }), "min-h-[44px]")}
                  >
                    <Plus className="mr-1.5 size-4" />
                    Cadastrar plantão
                  </Link>
                }
              />
            )}
          </Card>
        </section>
      </div>
    </main>
  );
}
