"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock3,
  CreditCard,
  Pencil,
  Trash2,
  User,
  AlertCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeletons";
import { Badge, FinancialStatusBadge, Card } from "@/components/ui/primitives";
import { getShift, saveShiftWithObligation, type Shift } from "@/lib/shifts";
import { financialAmounts, isOverdue, listObligations, type Obligation } from "@/lib/obligations";
import { listPayments, removePayment, type Payment } from "@/lib/payments";
import { listPlaces } from "@/lib/places";
import { listContacts } from "@/lib/contacts";
import { cn } from "cn";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (v: string) => new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR");
const labels = { agendado: "Agendado", realizado: "Realizado", cancelado: "Cancelado" } as const;

type Detail = {
  shift: Shift;
  obligation: Obligation | null;
  payments: Payment[];
  place: string;
  responsible: string;
};

export default function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function load(shiftId: string) {
    setState("loading");
    try {
      const shift = await getShift(shiftId);
      if (!shift) {
        setState("missing");
        return;
      }
      const [os, ps, places, contacts] = await Promise.all([
        listObligations(),
        listPayments(),
        listPlaces(),
        listContacts(),
      ]);
      const o = os.find((x) => x.shift_id === shift.id) ?? null;
      setDetail({
        shift,
        obligation: o,
        payments: o ? ps.filter((x) => x.obligation_id === o.id) : [],
        place: places.find((x) => x.id === shift.place_id)?.nome ?? "Local não encontrado",
        responsible: o?.responsavel_place_id
          ? places.find((x) => x.id === o.responsavel_place_id)?.nome ?? "Local não encontrado"
          : contacts.find((x) => x.id === o?.responsavel_contact_id)?.nome ??
            (o ? "Contato não encontrado" : "Não informado"),
      });
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void params.then((p) => {
      setId(p.id);
      void load(p.id);
    });
  }, [params]);

  async function cancelPaymentAction(payment: Payment) {
    if (!confirm(`Deseja cancelar o pagamento de ${brl.format(Number(payment.valor))}?`)) return;
    setBusy(payment.id);
    setMessage("");
    try {
      await removePayment(payment.id);
      await load(id);
    } catch {
      setMessage("Não foi possível cancelar o pagamento. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  async function cancelShiftAction() {
    if (!detail) return;
    if (detail.payments.some((p) => p.status === "registrado")) {
      setMessage("Não é possível cancelar um plantão com pagamentos registrados. Cancele os pagamentos primeiro.");
      return;
    }
    if (!confirm("Tem certeza que deseja cancelar este plantão?")) return;
    setBusy("cancel_shift");
    setMessage("");
    try {
      await saveShiftWithObligation(detail.shift.id, {
        place_id: detail.shift.place_id,
        data: detail.shift.data,
        hora_inicio: detail.shift.hora_inicio,
        hora_fim: detail.shift.hora_fim,
        valor_previsto: null,
        status: "cancelado",
        data_prevista: null,
        responsavel_place_id: null,
        responsavel_contact_id: null,
      });
      await load(id);
    } catch {
      setMessage("Não foi possível cancelar o plantão. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  if (state === "loading") {
    return (
      <main
        className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6"
        role="status"
        aria-label="Carregando ficha do plantão..."
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" />
          <span>Voltar ao calendário</span>
        </div>
        <div className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-8 w-56 animate-pulse rounded-lg bg-muted sm:w-72" />
              <div className="flex gap-2">
                <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
                <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
            <div className="h-11 w-36 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </main>
    );
  }

  if (state === "missing") {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-12 text-center sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Plantão não encontrado</h1>
        <p className="text-muted-foreground">Este plantão não existe ou não pertence à sua conta.</p>
        <Link
          href="/calendario"
          className={cn(buttonVariants({ variant: "default", size: "default" }), "min-h-[44px]")}
        >
          <ArrowLeft className="size-4" />
          Voltar ao calendário
        </Link>
      </main>
    );
  }

  if (state === "error" || !detail) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-12 text-center sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Ficha do plantão</h1>
        <p role="alert" className="text-destructive">
          Não foi possível carregar as informações deste plantão.
        </p>
        <Button onClick={() => void load(id)} className="min-h-[44px]">
          Tentar novamente
        </Button>
      </main>
    );
  }

  const { shift, obligation: o } = detail;
  const amounts = financialAmounts(shift.status, o);
  const overdue = o?.data_prevista ? isOverdue(o.data_prevista) : false;
  const progress = amounts.expected ? Math.min(100, Math.max(0, (amounts.received / amounts.expected) * 100)) : 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 pb-24 sm:pb-12">
      {/* Botão de retorno com área de toque >= 44x44px */}
      <Link
        href="/calendario"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        <ArrowLeft className="size-4" />
        <span>Voltar ao calendário</span>
      </Link>

      {/* Header com Badges Semânticos e Ações */}
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ficha do plantão
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{detail.place}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{labels[shift.status]}</Badge>
              {shift.status === "realizado" ? (
                o ? (
                  <FinancialStatusBadge
                    status="realizado"
                    isOverdue={overdue}
                    balance={amounts.balance}
                  />
                ) : (
                  <Badge variant="warning" dot>
                    Sem obrigação
                  </Badge>
                )
              ) : (
                <FinancialStatusBadge status={shift.status} />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={`/calendario?editar=${shift.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "min-h-[44px]")}
            >
              <Pencil className="size-4" />
              <span>Editar plantão</span>
            </Link>
            {shift.status !== "cancelado" && (
              <Button
                variant="ghost"
                size="default"
                disabled={busy === "cancel_shift"}
                onClick={() => void cancelShiftAction()}
                className="min-h-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" />
                <span>{busy === "cancel_shift" ? "Cancelando..." : "Cancelar plantão"}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {message && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Informações Cadastrais */}
      <section className="grid gap-3.5 sm:grid-cols-2">
        <Card className="p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">
            <Calendar className="size-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Data</p>
            <p className="mt-0.5 font-semibold text-foreground">{fmtDate(shift.data)}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">
            <Clock3 className="size-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Horário</p>
            <p className="mt-0.5 font-semibold text-foreground">
              {shift.hora_inicio.slice(0, 5)} – {shift.hora_fim.slice(0, 5)}
            </p>
          </div>
        </Card>
        <Card className="p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">
            <Building2 className="size-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Local</p>
            <p className="mt-0.5 font-semibold text-foreground">{detail.place}</p>
          </div>
        </Card>
        <Card className="p-4 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">
            <User className="size-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Responsável financeiro</p>
            <p className="mt-0.5 font-semibold text-foreground">{detail.responsible}</p>
          </div>
        </Card>
      </section>

      {/* Seção Financeira e Progresso */}
      {shift.status !== "realizado" ? (
        <Card className="p-5">
          <h2 className="font-semibold tracking-tight">Financeiro</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {shift.status === "cancelado"
              ? "Plantões cancelados não geram saldo ou recebimento."
              : "Plantão agendado: o valor e a data prevista se tornam exigíveis após a realização."}
          </p>
        </Card>
      ) : !o ? (
        <Card className="border-dashed p-6 text-center">
          <h2 className="font-semibold text-foreground">Obrigação financeira ausente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Este plantão realizado ainda não possui obrigação financeira vinculada.
          </p>
        </Card>
      ) : (
        <Card className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Resumo financeiro</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Data prevista para recebimento: {fmtDate(o.data_prevista)}
              </p>
            </div>
            <FinancialStatusBadge status="realizado" isOverdue={overdue} balance={amounts.balance} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              <p className="text-xs text-muted-foreground font-medium">Valor devido</p>
              <p className="mt-1 text-lg font-bold text-foreground">{brl.format(amounts.expected)}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              <p className="text-xs text-muted-foreground font-medium">Recebido</p>
              <p className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {brl.format(amounts.received)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              <p className="text-xs text-muted-foreground font-medium">Saldo a receber</p>
              <p className={cn("mt-1 text-lg font-bold", amounts.balance > 0 ? (overdue ? "text-destructive" : "text-amber-600 dark:text-amber-400") : "text-foreground")}>
                {brl.format(amounts.balance)}
              </p>
            </div>
          </div>

          {/* Barra de Progresso com Tokens Semânticos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">Progresso do recebimento</span>
              <span className="font-semibold">{Math.round(progress)}% recebido</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progresso do recebimento: ${Math.round(progress)}%`}
              className="h-3 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border/50"
            >
              <div
                className={cn(
                  "h-full transition-all duration-500 ease-out",
                  progress >= 100
                    ? "bg-emerald-500"
                    : overdue
                      ? "bg-destructive"
                      : "bg-primary"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Lista de Pagamentos e Ações */}
          <div className="space-y-3 pt-2">
            <h3 className="font-semibold text-sm">Histórico de pagamentos</h3>
            {detail.payments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Nenhum pagamento registrado até o momento.</p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {detail.payments.map((p) => (
                  <div className="flex items-center justify-between p-3.5 text-sm bg-card" key={p.id}>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <CreditCard className="size-4 text-muted-foreground" />
                        <span className="font-semibold">{brl.format(Number(p.valor))}</span>
                        {p.status === "cancelado" && <Badge variant="neutral">Cancelado</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">Pago em {fmtDate(p.data_pagamento)}</p>
                    </div>

                    {p.status === "registrado" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === p.id}
                        onClick={() => void cancelPaymentAction(p)}
                        aria-label={`Cancelar pagamento de ${brl.format(Number(p.valor))}`}
                        className="min-h-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        {busy === p.id ? "Cancelando..." : "Cancelar pagamento"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {amounts.balance > 0 && (
              <div className="pt-2">
                <Link
                  href="/pagamentos"
                  className={cn(buttonVariants({ variant: "default", size: "default" }), "w-full sm:w-auto min-h-[44px]")}
                >
                  Registrar pagamento
                </Link>
              </div>
            )}
          </div>
        </Card>
      )}
    </main>
  );
}
