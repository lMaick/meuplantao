"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronRight,
  Clock3,
  Download,
  Moon,
  SearchX,
  Sun,
  X,
} from "lucide-react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select, FinancialStatusBadge } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { HistorySkeleton } from "@/components/ui/skeletons";
import type { Contact } from "@/lib/contacts";
import type { Place } from "@/lib/places";
import type { Shift } from "@/lib/shifts";
import { financialAmounts, isOverdue, type Obligation } from "@/lib/obligations";
import {
  buildExtratoCsv,
  downloadExtratoCsv,
  extratoFilename,
  type ExtratoRow,
} from "@/lib/exports/extrato-csv";

type Props = {
  shifts: Shift[];
  places: Place[];
  obligations: Obligation[];
  contacts: Contact[];
  loading?: boolean;
};

type StatusFilter = "todos" | Shift["status"];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`));

export default function HistoryView({
  shifts,
  places,
  obligations,
  contacts,
  loading = false,
}: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [place, setPlace] = useState("todos");
  const [query, setQuery] = useState("");

  const hasActiveFilters = Boolean(
    from || to || status !== "todos" || place !== "todos" || query
  );

  function clearFilters() {
    setFrom("");
    setTo("");
    setStatus("todos");
    setPlace("todos");
    setQuery("");
  }

  const placeNames = useMemo(
    () => new Map(places.map((item) => [item.id, item.nome])),
    [places]
  );
  const contactNames = useMemo(
    () => new Map(contacts.map((item) => [item.id, item.nome])),
    [contacts]
  );

  const responsibleName = (obligation?: Obligation | null): string => {
    if (obligation?.responsavel_contact_id) {
      return `Contato · ${contactNames.get(obligation.responsavel_contact_id) ?? "não informado"}`;
    }
    if (obligation?.responsavel_place_id) {
      return `Local · ${placeNames.get(obligation.responsavel_place_id) ?? "não informado"}`;
    }
    return "Não informado";
  };

  const rows = useMemo(() => {
    return shifts
      .map((shift) => {
        const obligation = obligations.find((o) => o.shift_id === shift.id);
        const amounts = financialAmounts(shift.status, obligation);
        return {
          shift,
          obligation,
          received: amounts.received,
          balance: amounts.balance,
          expected: amounts.expected,
          placeName:
            places.find((item) => item.id === shift.place_id)?.nome ?? "Local removido",
        };
      })
      .filter(
        ({ shift, placeName }) =>
          (!from || shift.data >= from) &&
          (!to || shift.data <= to) &&
          (status === "todos" || shift.status === status) &&
          (place === "todos" || shift.place_id === place) &&
          (!query || placeName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      )
      .sort((a, b) => b.shift.data.localeCompare(a.shift.data));
  }, [from, to, status, place, query, shifts, places, obligations]);

  const totals = useMemo(() => {
    return rows.reduce(
      (sum, row) => {
        const amounts = financialAmounts(row.shift.status, row.obligation);
        return {
          expected: sum.expected + amounts.expected,
          received: sum.received + amounts.received,
          balance: sum.balance + amounts.balance,
        };
      },
      { expected: 0, received: 0, balance: 0 }
    );
  }, [rows]);

  function exportCsv() {
    const extrato: ExtratoRow[] = rows.map(
      ({ shift, obligation, placeName, expected, received, balance }) => ({
        dataPlantao: shift.data,
        local: placeName,
        tipo: null,
        statusPlantao: shift.status,
        responsavel: responsibleName(obligation),
        dataPrevista: obligation?.data_prevista ?? null,
        valorPrevisto: expected,
        valorRecebido: received,
        saldo: balance,
        atrasado: obligation && balance > 0 ? isOverdue(obligation.data_prevista) : false,
      })
    );
    downloadExtratoCsv(extratoFilename(), buildExtratoCsv(extrato));
  }

  if (loading) {
    return <HistorySkeleton />;
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header with Title and CSV Export */}
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 w-fit">
              <span className="size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              <span>Extrato Consolidado</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mt-1">
              Histórico financeiro
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Acompanhe o previsto, o recebido e o saldo de cada plantão.
            </p>
          </div>
          <Button
            type="button"
            onClick={exportCsv}
            variant="default"
            size="default"
            disabled={rows.length === 0}
            className="min-h-[44px] w-full sm:w-auto shrink-0 font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-sm shadow-emerald-700/20 transition-all"
          >
            <Download className="size-4" />
            Exportar CSV
          </Button>
        </header>

        {/* Filter Bar with 5 Form Controls (Touch targets >= 44px, no iOS auto-zoom) */}
        <section
          aria-label="Filtros do histórico"
          className="grid gap-3 rounded-2xl border border-border/80 bg-card p-4 sm:grid-cols-2 lg:grid-cols-5 shadow-xs"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="filter-from"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              De
            </label>
            <Input
              id="filter-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Data inicial"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="filter-to"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Até
            </label>
            <Input
              id="filter-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Data final"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="filter-status"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Status
            </label>
            <Select
              id="filter-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              aria-label="Status do plantão"
            >
              <option value="todos">Todos</option>
              <option value="realizado">Realizado</option>
              <option value="agendado">Agendado</option>
              <option value="cancelado">Cancelado</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="filter-place"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Local
            </label>
            <Select
              id="filter-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              aria-label="Filtrar por local"
            >
              <option value="todos">Todos os locais</option>
              {places.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <label
              htmlFor="filter-query"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Buscar local
            </label>
            <Input
              id="filter-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ex.: Hospital"
              aria-label="Buscar local por nome"
            />
          </div>
        </section>

        {/* 3 Metric Cards (Using standard StatCard primitive) */}
        <section aria-label="Totais financeiros" className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Total previsto"
            value={<span className="font-mono tracking-tight">{money.format(totals.expected)}</span>}
            detail={`${rows.length} ${rows.length === 1 ? "plantão" : "plantões"} no filtro`}
          />
          <StatCard
            label="Total recebido"
            value={<span className="font-mono tracking-tight text-emerald-600 dark:text-emerald-400">{money.format(totals.received)}</span>}
            detail="Pagamentos registrados"
          />
          <StatCard
            label="Saldo restante"
            value={<span className="font-mono tracking-tight">{money.format(totals.balance)}</span>}
            detail={totals.balance > 0 ? "Aguardando recebimento" : "100% quitado"}
          />
        </section>

        {/* Shifts List / Table Section */}
        <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
          {/* Header Bar with Count and Clear Filters */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{rows.length}</span>{" "}
              {rows.length === 1 ? "plantão encontrado" : "plantões encontrados"}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                <X className="size-3.5" />
                Limpar filtros
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="p-6 sm:p-12">
              <EmptyState
                icon={SearchX}
                title="Nenhum plantão encontrado"
                description={
                  hasActiveFilters
                    ? "Tente ajustar os filtros de período ou local."
                    : "Você ainda não possui plantões registrados no histórico."
                }
                action={
                  hasActiveFilters ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={clearFilters}
                      className="min-h-[44px]"
                    >
                      Limpar filtros
                    </Button>
                  ) : (
                    <Link
                      href="/calendario?novo=1"
                      className={cn(buttonVariants({ variant: "default", size: "default" }), "min-h-[44px]")}
                    >
                      Cadastrar plantão
                    </Link>
                  )
                }
              />
            </div>
          ) : (
            <>
              {/* Desktop Table View (>= 640px sm:block) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Local</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Previsto</th>
                      <th className="px-4 py-3 text-right">Recebido</th>
                      <th className="px-4 py-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(
                      ({ shift, obligation, placeName, expected, received, balance }) => {
                        const overdue =
                          obligation && balance > 0
                            ? isOverdue(obligation.data_prevista)
                            : false;
                        return (
                          <tr
                            key={shift.id}
                            className="transition-colors hover:bg-muted/40"
                          >
                            <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground">
                              <Link
                                href={`/calendario/plantao/${shift.id}`}
                                className="hover:text-foreground hover:underline transition-colors"
                              >
                                {date(obligation?.data_prevista ?? shift.data)}
                              </Link>
                            </td>
                            <td className="px-4 py-3.5 font-medium text-foreground">
                              <Link
                                href={`/calendario/plantao/${shift.id}`}
                                className="hover:underline transition-colors"
                              >
                                {placeName}
                              </Link>
                            </td>
                            <td className="px-4 py-3.5">
                              <FinancialStatusBadge
                                status={shift.status}
                                isOverdue={overdue}
                                balance={balance}
                              />
                            </td>
                            <td className="px-4 py-3.5 text-right font-medium text-foreground font-mono tracking-tight">
                              {money.format(expected)}
                            </td>
                            <td className="px-4 py-3.5 text-right font-medium text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
                              {money.format(received)}
                            </td>
                            <td className="px-4 py-3.5 text-right font-semibold text-foreground font-mono tracking-tight">
                              {money.format(balance)}
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List View (< 640px sm:hidden) */}
              <div className="divide-y divide-border sm:hidden">
                {rows.map(
                  ({ shift, obligation, placeName, expected, received, balance }) => {
                    const overdue =
                      obligation && balance > 0
                        ? isOverdue(obligation.data_prevista)
                        : false;
                    const isNight = shift.hora_inicio >= "18:00" || shift.hora_inicio < "06:00";
                    return (
                      <article
                        key={shift.id}
                        className="p-4 space-y-3 transition-colors hover:bg-muted/30"
                        aria-label={`Plantão em ${placeName}`}
                      >
                        {/* Top row: Date/Hours + Status Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="size-3.5 shrink-0" />
                                <span>{date(obligation?.data_prevista ?? shift.data)}</span>
                              </span>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="size-3.5 shrink-0" />
                                <span>
                                  {shift.hora_inicio.slice(0, 5)}–{shift.hora_fim.slice(0, 5)}
                                </span>
                              </span>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                {isNight ? (
                                  <Moon className="size-3 text-indigo-500 shrink-0" />
                                ) : (
                                  <Sun className="size-3 text-amber-500 shrink-0" />
                                )}
                                <span>{isNight ? "Noturno" : "Diurno"}</span>
                              </span>
                            </div>
                            <h3 className="font-semibold text-foreground leading-snug pt-1 truncate">
                              <Link
                                href={`/calendario/plantao/${shift.id}`}
                                className="hover:underline focus-visible:underline focus-visible:outline-hidden"
                              >
                                {placeName}
                              </Link>
                            </h3>
                          </div>
                          <FinancialStatusBadge
                            status={shift.status}
                            isOverdue={overdue}
                            balance={balance}
                            className="shrink-0"
                          />
                        </div>

                        {/* 3-Column Financial Grid */}
                        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/60 bg-muted/40 p-2.5 text-center text-xs">
                          <div>
                            <span className="block text-[11px] font-medium text-muted-foreground">
                              Previsto
                            </span>
                            <span className="mt-0.5 block font-medium text-foreground font-mono tracking-tight">
                              {money.format(expected)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[11px] font-medium text-muted-foreground">
                              Recebido
                            </span>
                            <span className="mt-0.5 block font-medium text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
                              {money.format(received)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[11px] font-medium text-muted-foreground">
                              Saldo
                            </span>
                            <span
                              className={cn(
                                "mt-0.5 block font-semibold font-mono tracking-tight",
                                balance > 0 ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {money.format(balance)}
                            </span>
                          </div>
                        </div>

                        {/* Bottom Action: 44px Touch Target Link to Shift Details */}
                        <div className="flex items-center justify-end pt-1">
                          <Link
                            href={`/calendario/plantao/${shift.id}`}
                            className="inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-primary hover:underline"
                          >
                            <span>Ver detalhes</span>
                            <ChevronRight className="size-4" />
                          </Link>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
