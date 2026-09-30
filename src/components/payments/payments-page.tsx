"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  DollarSign,
  Download,
  FilterX,
  Moon,
  Plus,
  Sun,
  User,
  WalletCards,
  X,
} from "lucide-react";
import { createPayment, listPayments, removePayment, type Payment } from "@/lib/payments";
import { listShifts, type Shift } from "@/lib/shifts";
import { listObligations, type Obligation, isOverdue } from "@/lib/obligations";
import { listPlaces, type Place } from "@/lib/places";
import { listContacts, type Contact } from "@/lib/contacts";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select, FinancialStatusBadge } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { PaymentsSkeleton } from "@/components/ui/skeletons";
import { buildExtratoCsv, downloadExtratoCsv, extratoFilename, type ExtratoRow } from "@/lib/exports/extrato-csv";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { ALL_PERIODS, ALL_PLACES, currentMonthValue, matchesShift } from "@/lib/finance-filters";
import { useFocusTrap } from "@/lib/accessibility/use-focus-trap";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const bahiaTodayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());

type Filter = "todos" | "atrasados" | "a-vencer" | "pagos";

type Row = {
  shift: Shift;
  obligation: Obligation;
  placeName: string;
  responsible: string;
  expected: number;
  received: number;
  balance: number;
  isOverdue: boolean;
};

function parseValidFilter(value: string | null): Filter | null {
  if (value === "todos" || value === "atrasados" || value === "a-vencer" || value === "pagos") return value;
  return null;
}

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const paramFilter = parseValidFilter(searchParams.get("filter") || searchParams.get("status"));
  const paramPeriod = searchParams.get("period");
  const paramPlaceId = searchParams.get("placeId");
  const openObligationId = searchParams.get("open");

  const [payments, setPayments] = useState<Payment[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [userPeriod, setPeriod] = useState<string | null>(null);
  const [userPlaceId, setPlaceId] = useState<string | null>(null);
  const [userFilter, setFilter] = useState<Filter | null>(null);

  // Quick Action "Receber" Modal State
  const [modalRow, setModalRow] = useState<Row | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const paymentModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRow !== null, paymentModalRef);
  useEffect(() => {
    if (!confirmation) return;
    const timeout = window.setTimeout(() => setConfirmation(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [confirmation]);
  const [modalAmount, setModalAmount] = useState("");
  const [modalDate, setModalDate] = useState(() => bahiaTodayIso());
  const [modalError, setModalError] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const autoOpenedRef = useRef(false);

  // Inline general form state (for backward compatibility & accessibility)
  const [inlineShiftId, setInlineShiftId] = useState("");
  const [inlineAmount, setInlineAmount] = useState("");
  const [inlineDate, setInlineDate] = useState(() => bahiaTodayIso());
  const [inlineError, setInlineError] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);

  const period = userPeriod ?? paramPeriod ?? currentMonthValue();
  const placeId = userPlaceId ?? paramPlaceId ?? ALL_PLACES;
  const filter = userFilter ?? paramFilter ?? "todos";

  async function load() {
    try {
      const [p, s, o, l, c] = await Promise.all([
        listPayments(),
        listShifts(),
        listObligations(),
        listPlaces(),
        listContacts(),
      ]);
      setPayments(p);
      setShifts(s);
      setObligations(o);
      setPlaces(l);
      setContacts(c);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e: unknown) => setInlineError(e instanceof Error ? e.message : "Não foi possível carregar os recebimentos."));
  }, []);

  const rows = useMemo<Row[]>(() => {
    const placeNames = new Map(places.map((p) => [p.id, p.nome]));
    const contactNames = new Map(contacts.map((c) => [c.id, c.nome]));

    return shifts
      .filter((s) => s.status === "realizado" && matchesShift(s, period, placeId))
      .flatMap((shift) => {
        const obligation = obligations.find((o) => o.shift_id === shift.id);
        if (!obligation || obligation.valor_devido === null) return [];

        const expected = Number(obligation.valor_devido);
        const balance = Math.max(0, Number(obligation.saldo ?? 0));
        const overdue = balance > 0 && isOverdue(obligation.data_prevista);

        return [
          {
            shift,
            obligation,
            placeName: placeNames.get(shift.place_id) ?? "Local não informado",
            responsible: obligation.responsavel_contact_id
              ? `Contato · ${contactNames.get(obligation.responsavel_contact_id) ?? "não informado"}`
              : `Local · ${placeNames.get(obligation.responsavel_place_id ?? "") ?? "não informado"}`,
            expected,
            received: Math.max(0, expected - balance),
            balance,
            isOverdue: overdue,
          },
        ];
      });
  }, [contacts, obligations, places, shifts, period, placeId]);

  const visible = useMemo(
    () =>
      rows.filter(({ isOverdue: overdue, balance }) => {
        if (filter === "todos") return true;
        if (filter === "pagos") return balance === 0;
        if (filter === "atrasados") return balance > 0 && overdue;
        if (filter === "a-vencer") return balance > 0 && !overdue;
        return true;
      }),
    [filter, rows]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (r, row) => ({
          expected: r.expected + row.expected,
          received: r.received + row.received,
          balance: r.balance + row.balance,
        }),
        { expected: 0, received: 0, balance: 0 }
      ),
    [rows]
  );

  // Counts for filter pills
  const counts = useMemo(() => {
    let pagos = 0;
    let atrasados = 0;
    let aVencer = 0;
    for (const r of rows) {
      if (r.balance === 0) pagos++;
      else if (r.isOverdue) atrasados++;
      else aVencer++;
    }
    return { todos: rows.length, atrasados, aVencer, pagos };
  }, [rows]);

  const selectedInline = rows.find(({ shift }) => shift.id === inlineShiftId);
  const inlineRemaining = selectedInline?.balance ?? 0;
  const registered = payments.filter((p) => p.status === "registrado");

  useEffect(() => {
    if (loading || autoOpenedRef.current || !openObligationId) return;
    const target = rows.find(({ obligation }) => obligation.id === openObligationId);
    if (!target) return;

    autoOpenedRef.current = true;
    const timer = window.setTimeout(() => {
      setModalRow(target);
      setModalAmount(target.balance > 0 ? target.balance.toFixed(2) : "");
      setModalDate(bahiaTodayIso());
      setModalError("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading, openObligationId, rows]);

  // Modal actions
  function openPaymentModal(row: Row) {
    setModalRow(row);
    setModalAmount(row.balance > 0 ? row.balance.toFixed(2) : "");
    setModalDate(bahiaTodayIso());
    setModalError("");
  }

  function closePaymentModal() {
    setModalRow(null);
    setModalAmount("");
    setModalError("");
  }

  async function handleModalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modalRow) return;

    setModalError("");
    const value = Number(modalAmount);

    if (!Number.isFinite(value) || value <= 0) {
      setModalError("Informe um valor positivo para o pagamento.");
      return;
    }

    if (value > modalRow.balance) {
      setModalError(`O valor não pode exceder o saldo restante (${money.format(modalRow.balance)}).`);
      return;
    }

    if (!modalDate) {
      setModalError("Informe a data do pagamento.");
      return;
    }

    if (modalDate > bahiaTodayIso()) {
      setModalError("Data de recebimento não pode ser futura.");
      return;
    }

    setModalSaving(true);
    try {
      await createPayment({
        obligation_id: modalRow.obligation.id,
        valor: value,
        data_pagamento: modalDate,
      });
      closePaymentModal();
      setConfirmation(
        value === modalRow.balance
          ? "Plantão quitado. Recebimento registrado."
          : "Recebimento registrado. Saldo atualizado."
      );
      await load();
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : "Não foi possível registrar o pagamento.");
    } finally {
      setModalSaving(false);
    }
  }

  // Inline submit (general form)
  async function handleInlineSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInlineError("");
    const value = Number(inlineAmount);

    if (!inlineDate) {
      setInlineError("Informe a data do pagamento.");
      return;
    }

    if (inlineDate > bahiaTodayIso()) {
      setInlineError("Data de recebimento não pode ser futura.");
      return;
    }

    if (!selectedInline || !Number.isFinite(value) || value <= 0 || value > inlineRemaining) {
      setInlineError("Informe um valor positivo, até o saldo restante da obrigação.");
      return;
    }

    setInlineSaving(true);
    try {
      await createPayment({
        obligation_id: selectedInline.obligation.id,
        valor: value,
        data_pagamento: inlineDate,
      });
      setInlineAmount("");
      await load();
    } catch (e: unknown) {
      setInlineError(e instanceof Error ? e.message : "Não foi possível registrar o pagamento.");
    } finally {
      setInlineSaving(false);
    }
  }

  async function cancel(payment: Payment) {
    if (!window.confirm("Cancelar este pagamento? O valor voltará ao saldo da obrigação.")) return;
    try {
      await removePayment(payment.id);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Não foi possível cancelar o pagamento.");
    }
  }

  function exportCsv() {
    const extrato: ExtratoRow[] = visible.map(
      ({ shift, obligation, placeName, responsible, expected, received, balance, isOverdue: overdue }) => ({
        dataPlantao: shift.data,
        local: placeName,
        tipo: null,
        statusPlantao: shift.status,
        responsavel: responsible,
        dataPrevista: obligation.data_prevista,
        valorPrevisto: expected,
        valorRecebido: received,
        saldo: balance,
        atrasado: overdue,
      })
    );
    downloadExtratoCsv(extratoFilename(), buildExtratoCsv(extrato));
  }

  if (loading) {
    return <PaymentsSkeleton />;
  }

  const filters: [Filter, string, number][] = [
    ["todos", "Todos", counts.todos],
    ["atrasados", "Atrasados", counts.atrasados],
    ["a-vencer", "A vencer", counts.aVencer],
    ["pagos", "Pagos", counts.pagos],
  ];

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 text-foreground">
      {confirmation && (
        <div
          role="status"
          aria-live="polite"
          className="motion-success fixed bottom-24 left-4 right-4 z-50 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-semibold text-foreground shadow-lg sm:left-auto sm:right-6 sm:max-w-sm"
        >
          {confirmation}
        </div>
      )}
      {/* Page Header */}
      <header className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 w-fit">
          <span className="size-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
          <span>Gestão de Recebíveis</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 mt-1">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">A receber</h1>
            <p className="mt-1 text-sm sm:text-base text-muted-foreground">
              Acompanhe e registre os pagamentos devidos por plantão realizado.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 min-h-[44px] gap-2 font-medium"
            onClick={exportCsv}
            disabled={visible.length === 0}
          >
            <Download className="size-4" />
            Exportar CSV
          </Button>
        </div>
      </header>

      {/* Period & Place Filter Bar */}
      <FinanceFilters
        period={period}
        placeId={placeId}
        places={places}
        onPeriodChange={setPeriod}
        onPlaceChange={setPlaceId}
      />

      {/* Metric Cards / Totalizers */}
      <section className="grid gap-4" aria-labelledby="receivables-summary-title">
        <div>
          <h2 id="receivables-summary-title" className="text-base font-semibold tracking-tight text-foreground">
            Resumo dos recebimentos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O que foi combinado, o que já entrou e o que ainda falta receber.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Métricas financeiras do período">
        <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/40">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total dos plantões</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <WalletCards className="size-4.5" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold font-mono tracking-tight text-foreground">{money.format(totals.expected)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "plantão realizado" : "plantões realizados"}
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/40">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Já recebido</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
              <ArrowDownToLine className="size-4.5" />
            </span>
          </div>
          <p className="mt-3 text-2xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {money.format(totals.received)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {counts.pagos} {counts.pagos === 1 ? "plantão quitado" : "plantões quitados"}
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 shadow-xs transition-all duration-200 hover:shadow-md">
          <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">Ainda falta receber</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
              <CircleAlert className="size-4.5" />
            </span>
          </div>
          <p className={cn("mt-3 text-2xl font-bold font-mono tracking-tight", totals.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
            {money.format(totals.balance)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {counts.atrasados > 0
              ? `${counts.atrasados} em atraso`
              : `${counts.aVencer} a vencer`}
          </p>
        </div>
        </div>
      </section>

      {/* General Payment Registration Bar (Collapsible / Backward-Compatible) */}
      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
        <h2 className="text-base font-semibold tracking-tight">Registrar pagamento rápido</h2>
        <form onSubmit={handleInlineSubmit} className="mt-4 grid gap-4 sm:grid-cols-[1fr_160px_170px_auto] sm:items-end">
          <label className="grid gap-1.5 text-sm font-medium">
            <span>Plantão com saldo em aberto</span>
            <Select
              className="h-11 min-h-[44px] text-base md:text-sm font-normal"
              value={inlineShiftId}
              onChange={(e) => {
                setInlineShiftId(e.target.value);
                const found = rows.find((r) => r.shift.id === e.target.value);
                if (found) setInlineAmount(found.balance.toFixed(2));
              }}
            >
              <option value="">Selecione um plantão</option>
              {rows
                .filter((r) => r.balance > 0)
                .map(({ shift, placeName, balance }) => (
                  <option key={shift.id} value={shift.id}>
                    {formatDate(shift.data)} · {placeName} · Saldo {money.format(balance)}
                  </option>
                ))}
            </Select>
          </label>

          <label className="grid gap-1.5 text-sm font-medium">
            <span>Valor (R$)</span>
            <Input
              type="number"
              min="0.01"
              max={inlineRemaining || undefined}
              step="0.01"
              value={inlineAmount}
              onChange={(e) => setInlineAmount(e.target.value)}
              placeholder="0,00"
              className="h-11 min-h-[44px] text-base md:text-sm font-normal"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium">
            <span>Data de recebimento</span>
            <Input
              type="date"
              value={inlineDate}
              max={bahiaTodayIso()}
              onChange={(e) => setInlineDate(e.target.value)}
              className="h-11 min-h-[44px] text-base md:text-sm font-normal"
            />
          </label>

          <Button
            type="submit"
            className="h-11 min-h-[44px] px-6 font-medium"
            disabled={inlineSaving || !selectedInline || inlineRemaining === 0}
          >
            {inlineSaving ? "Salvando..." : "Registrar"}
          </Button>
        </form>
        {inlineError && (
          <p role="alert" className="mt-3 text-sm font-medium text-destructive">
            {inlineError}
          </p>
        )}
      </section>

      {/* Receivables List Section */}
      <section className="space-y-5" aria-labelledby="receivables-title">
        {/* Section Header & Status Tabs */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="receivables-title" className="text-xl font-bold tracking-tight">
              Obrigações e recebimentos
            </h2>
            <p className="text-sm text-muted-foreground">
              {visible.length} {visible.length === 1 ? "registro encontrado" : "registros encontrados"}
            </p>
          </div>

          {/* Filter Pills with >= 44px Touch Targets */}
          <div
            className="flex gap-2 overflow-x-auto pb-1 text-sm no-scrollbar"
            role="group"
            aria-label="Filtrar recebimentos por status"
          >
            {filters.map(([val, label, count]) => {
              const active = filter === val;
              return (
                <Button
                  key={val}
                  type="button"
                  variant={active ? "default" : "outline"}
                  className="h-11 min-h-[44px] shrink-0 gap-2 px-4 font-medium"
                  onClick={() => setFilter(val)}
                  aria-pressed={active}
                >
                  <span>{label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Content Body: EmptyState vs Card Grid */}
        {visible.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Nenhum recebimento encontrado"
              description="Registre um plantão realizado com valor devido para acompanhar seus recebimentos e saldos em aberto."
              action={
                <Link
                  href="/calendario?novo=1"
                  className={cn(buttonVariants({ variant: "default", size: "default" }), "h-11 min-h-[44px] gap-2 px-5 font-medium")}
                >
                  <Plus className="size-4" />
                  Registrar plantão
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={FilterX}
              title={
                filter === "pagos"
                  ? "Nenhum plantão pago encontrado"
                  : filter === "atrasados"
                  ? "Nenhum recebimento atrasado"
                  : filter === "a-vencer"
                  ? "Nenhum recebimento a vencer"
                  : "Nenhum recebimento no período"
              }
              description="Não há recebimentos correspondentes aos filtros selecionados. Tente ajustar o período ou o status."
              action={
                <Button
                  variant="outline"
                  className="h-11 min-h-[44px] px-5 font-medium"
                  onClick={() => {
                    setFilter("todos");
                    setPeriod(ALL_PERIODS);
                    setPlaceId(ALL_PLACES);
                  }}
                >
                  Limpar filtros
                </Button>
              }
            />
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visible.map((row) => {
              const { shift, obligation, placeName, responsible, expected, received, balance, isOverdue: overdue } = row;
              const isPaid = balance === 0;

              return (
                <article
                  key={obligation.id}
                  className={`flex flex-col justify-between rounded-2xl border bg-card p-5 shadow-xs transition-all hover:shadow-sm ${
                    overdue
                      ? "border-destructive/40 bg-destructive/[0.02]"
                      : isPaid
                      ? "border-border/60 bg-muted/20"
                      : "border-border/80"
                  }`}
                >
                  <div>
                    {/* Top Row: Meta and Status Badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                          <User className="size-3.5 shrink-0" />
                          <span>{responsible}</span>
                        </p>
                        <h3 className="text-base font-bold tracking-tight text-foreground">{placeName}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="size-3.5 shrink-0" />
                            <span>
                              Plantão de {formatDate(shift.data)} · {shift.hora_inicio.slice(0, 5)}–{shift.hora_fim.slice(0, 5)}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                            {shift.hora_inicio >= "18:00" || shift.hora_inicio < "06:00" ? (
                              <Moon className="size-3 text-indigo-500" />
                            ) : (
                              <Sun className="size-3 text-amber-500" />
                            )}
                            <span>{shift.hora_inicio >= "18:00" || shift.hora_inicio < "06:00" ? "Noturno" : "Diurno"}</span>
                          </span>
                        </div>
                      </div>

                      <FinancialStatusBadge status="realizado" isOverdue={overdue} balance={balance} />
                    </div>

                    {/* Financial Metrics Grid */}
                    <dl className="mt-5 grid grid-cols-3 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Data prevista</dt>
                        <dd className={`mt-0.5 font-semibold text-xs sm:text-sm ${overdue ? "text-destructive font-bold" : ""}`}>
                          {formatDate(obligation.data_prevista)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Devido</dt>
                        <dd className="mt-0.5 font-semibold font-mono text-xs sm:text-sm text-foreground">{money.format(expected)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Recebido</dt>
                        <dd className="mt-0.5 font-semibold font-mono text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                          {money.format(received)}
                        </dd>
                      </div>
                    </dl>

                    {/* Balance and Shift Link */}
                    <div className="mt-4 flex items-center justify-between border-t border-border/80 pt-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Saldo restante</p>
                        <p
                          className={`text-lg font-bold font-mono tracking-tight ${
                            isPaid
                              ? "text-muted-foreground"
                              : overdue
                              ? "text-destructive"
                              : "text-foreground"
                          }`}
                        >
                          {money.format(balance)}
                        </p>
                      </div>

                      <Link
                        className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-primary hover:underline"
                        href={`/calendario/plantao/${shift.id}`}
                      >
                        <span>Ver plantão</span>
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </div>

                    {/* Registered Payments History */}
                    {registered.filter((p) => p.obligation_id === obligation.id).length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Pagamentos registrados
                        </p>
                        {registered
                          .filter((p) => p.obligation_id === obligation.id)
                          .map((payment) => (
                            <div
                              key={payment.id}
                              className="flex items-center justify-between rounded-lg bg-background px-3 py-1.5 text-xs text-muted-foreground"
                            >
                              <span>
                                {money.format(Number(payment.valor))} em {formatDate(payment.data_pagamento)}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-11 min-h-[44px] px-3 text-xs font-medium text-destructive hover:bg-destructive/10 cursor-pointer"
                                onClick={() => void cancel(payment)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Quick-Action Button "Receber" */}
                  <div className="mt-5 pt-3 border-t border-border/60">
                    {balance > 0 ? (
                      <Button
                        type="button"
                        className="h-11 min-h-[44px] w-full gap-2 font-semibold"
                        onClick={() => openPaymentModal(row)}
                      >
                        <DollarSign className="size-4.5" />
                        Receber {money.format(balance)}
                      </Button>
                    ) : (
                      <div className="flex h-11 min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="size-4" />
                        Totalmente quitado
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick-Action "Receber" Modal / Mobile Drawer (z-50) */}
      {modalRow && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-modal-title"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !modalSaving) closePaymentModal();
          }}
        >
          <div ref={paymentModalRef} tabIndex={-1} className="w-full max-w-md rounded-t-2xl border border-border bg-card p-5 sm:p-6 shadow-xl text-card-foreground sm:rounded-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-in fade-in duration-200">
            {/* Mobile drag handle indicator */}
            <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-muted-foreground/30 sm:hidden" />

            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="payment-modal-title" className="text-xl font-bold tracking-tight text-foreground">
                  Registrar recebimento
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {modalRow.placeName} · Plantão de {formatDate(modalRow.shift.data)}
                </p>
              </div>
              <button
                type="button"
                disabled={modalSaving}
                onClick={closePaymentModal}
                aria-label="Fechar modal"
                className="inline-flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Summary Box */}
            <div className="mt-4 rounded-xl bg-muted/40 p-3.5 text-sm space-y-1">
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>Valor previsto:</span>
                <span>{money.format(modalRow.expected)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>Já recebido:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {money.format(modalRow.received)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border/80 pt-1.5 font-bold text-foreground">
                <span>Saldo em aberto:</span>
                <span className="text-amber-600 dark:text-amber-400">{money.format(modalRow.balance)}</span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleModalSubmit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="modal-amount" className="text-sm font-semibold text-foreground">
                    Valor a receber (R$)
                  </label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                    onClick={() => setModalAmount(modalRow.balance.toFixed(2))}
                  >
                    Valor integral
                  </button>
                </div>
                <Input
                  id="modal-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={modalRow.balance}
                  required
                  autoFocus
                  value={modalAmount}
                  onChange={(e) => setModalAmount(e.target.value)}
                  placeholder="0,00"
                  className="h-11 min-h-[44px] text-base md:text-sm font-semibold text-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="modal-date" className="text-sm font-semibold text-foreground">
                  Data do pagamento
                </label>
                <Input
                  id="modal-date"
                  type="date"
                  required
                  value={modalDate}
                  max={bahiaTodayIso()}
                  onChange={(e) => setModalDate(e.target.value)}
                  className="h-11 min-h-[44px] text-base md:text-sm"
                />
              </div>

              {modalError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {modalError}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={modalSaving}
                  onClick={closePaymentModal}
                  className="h-11 min-h-[44px] flex-1 font-medium"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={modalSaving}
                  className="h-11 min-h-[44px] flex-1 font-semibold"
                >
                  {modalSaving ? "Salvando..." : "Confirmar"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

