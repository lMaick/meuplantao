"use client";

import { useEffect, useMemo, useState } from "react";
import { createPayment, listPayments, removePayment, type Payment } from "@/lib/payments";
import { listShifts, type Shift } from "@/lib/shifts";
import { listObligations, type Obligation } from "@/lib/obligations";
import { Button } from "@/components/ui/button";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [shiftId, setShiftId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [nextPayments, nextShifts, nextObligations] = await Promise.all([listPayments(), listShifts(), listObligations()]);
    setPayments(nextPayments);
    setShifts(nextShifts);
    setObligations(nextObligations);
  }

  useEffect(() => {
    void Promise.resolve().then(load).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os pagamentos."));
  }, []);

  const realized = shifts.filter((shift) => shift.status === "realizado");
  const paidByShift = useMemo(() => payments.filter((payment) => payment.status === "registrado").reduce<Record<string, number>>((result, payment) => {
    const shiftId = obligations.find((obligation) => obligation.id === payment.obligation_id)?.shift_id;
    if (shiftId) result[shiftId] = (result[shiftId] ?? 0) + Number(payment.valor);
    return result;
  }, {}), [payments, obligations]);
  const totals = useMemo(() => realized.reduce((result, shift) => {
    const paid = paidByShift[shift.id] ?? 0;
    result.expected += Number(shift.valor_previsto); result.paid += paid; result.balance += Math.max(0, Number(shift.valor_previsto) - paid); return result;
  }, { expected: 0, paid: 0, balance: 0 }), [realized, paidByShift]);
  const selected = realized.find((shift) => shift.id === shiftId);
  const remaining = selected ? Math.max(0, Number(selected.valor_previsto) - (paidByShift[selected.id] ?? 0)) : 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const value = Number(amount);
    if (!selected || !Number.isFinite(value) || value <= 0 || value > remaining) { setError("Informe um valor positivo, até o saldo restante do plantão."); return; }
    setSaving(true);
    try { const obligation = obligations.find((item) => item.shift_id === selected.id); if (!obligation) throw new Error("Obrigacao financeira nao encontrada."); await createPayment({ obligation_id: obligation.id, valor: value, data_pagamento: paymentDate }); setAmount(""); await load(); }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Não foi possível registrar o pagamento."); }
    finally { setSaving(false); }
  }

  async function cancel(payment: Payment) {
    if (!window.confirm("Cancelar este pagamento? O valor voltará ao saldo do plantão.")) return;
    setError(""); try { await removePayment(payment.id); await load(); } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Não foi possível cancelar o pagamento."); }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6">
    <header><p className="text-sm font-medium text-muted-foreground">Financeiro</p><h1 className="text-3xl font-semibold tracking-tight">Pagamentos</h1><p className="mt-2 text-muted-foreground">Acompanhe o que já recebeu e o saldo de cada plantão realizado.</p></header>
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo financeiro">
      {[['Total previsto', totals.expected], ['Recebido', totals.paid], ['Saldo a receber', totals.balance]].map(([label, value]) => <div className="rounded-xl border bg-card p-4" key={label as string}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{money.format(value as number)}</p></div>)}
    </section>
    <section className="rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">Registrar pagamento</h2><form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[1fr_150px_170px_auto] sm:items-end">
      <label className="grid gap-1 text-sm font-medium">Plantão realizado<select className="h-10 rounded-lg border bg-background px-3 font-normal" value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="">Selecione um plantão</option>{realized.map((shift) => <option key={shift.id} value={shift.id}>{date(shift.data)} · saldo {money.format(Math.max(0, Number(shift.valor_previsto) - (paidByShift[shift.id] ?? 0)))}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-medium">Valor<input className="h-10 rounded-lg border bg-background px-3 font-normal" type="number" min="0.01" max={remaining || undefined} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></label>
      <label className="grid gap-1 text-sm font-medium">Data do pagamento<input className="h-10 rounded-lg border bg-background px-3 font-normal" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
      <Button disabled={saving || !selected}>{saving ? "Salvando..." : "Registrar"}</Button>
    </form>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Plantões realizados</h2>{realized.length === 0 ? <p className="rounded-xl border p-5 text-muted-foreground">Nenhum plantão realizado para acompanhar.</p> : realized.map((shift) => { const paid = paidByShift[shift.id] ?? 0; const balance = Math.max(0, Number(shift.valor_previsto) - paid); return <div className="rounded-xl border bg-card p-4" key={shift.id}><div className="flex flex-wrap justify-between gap-3"><div><p className="font-medium">Plantão de {date(shift.data)}</p><p className="text-sm text-muted-foreground">Recebido {money.format(paid)} de {money.format(Number(shift.valor_previsto))}</p></div><p className={`font-semibold ${balance === 0 ? "text-emerald-600" : "text-amber-600"}`}>{balance === 0 ? "Pago integralmente" : `Saldo ${money.format(balance)}`}</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, paid / Number(shift.valor_previsto || 1) * 100)}%` }} /></div>{payments.filter((payment) => payment.shift_id === shift.id).map((payment) => <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm" key={payment.id}><span>{money.format(Number(payment.valor))} · {date(payment.data_pagamento)}{payment.status === "cancelado" ? " · cancelado" : ""}</span>{payment.status === "registrado" && <Button type="button" variant="ghost" size="sm" onClick={() => cancel(payment)}>Cancelar</Button>}</div>)}</div>; })}</section>
  </main>;
}
