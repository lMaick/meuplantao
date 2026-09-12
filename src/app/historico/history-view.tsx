"use client";

import { useMemo, useState } from "react";
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

type Props = { shifts: Shift[]; places: Place[]; obligations: Obligation[]; contacts: Contact[] };
type StatusFilter = "todos" | Shift["status"];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`));

export default function HistoryView({ shifts, places, obligations, contacts }: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [place, setPlace] = useState("todos");
  const [query, setQuery] = useState("");

  const placeNames = useMemo(() => new Map(places.map((item) => [item.id, item.nome])), [places]);
  const contactNames = useMemo(() => new Map(contacts.map((item) => [item.id, item.nome])), [contacts]);

  const responsibleName = (obligation?: Obligation | null): string => {
    if (obligation?.responsavel_contact_id) return `Contato \u00b7 ${contactNames.get(obligation.responsavel_contact_id) ?? "n\u00e3o informado"}`;
    if (obligation?.responsavel_place_id) return `Local \u00b7 ${placeNames.get(obligation.responsavel_place_id) ?? "n\u00e3o informado"}`;
    return "N\u00e3o informado";
  };

  const rows = useMemo(() => shifts.map((shift) => {
    const obligation = obligations.find((o) => o.shift_id === shift.id);
    const amounts = financialAmounts(shift.status, obligation); return { shift, obligation, received: amounts.received, balance: amounts.balance, expected: amounts.expected, placeName: places.find((item) => item.id === shift.place_id)?.nome ?? "Local removido" };
  }).filter(({ shift, placeName }) => (!from || shift.data >= from) && (!to || shift.data <= to) && (status === "todos" || shift.status === status) && (place === "todos" || shift.place_id === place) && (!query || placeName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => b.shift.data.localeCompare(a.shift.data)), [from, to, status, place, query, shifts, places, obligations]);

  const totals = rows.reduce((sum, row) => { const amounts = financialAmounts(row.shift.status, row.obligation); return { expected: sum.expected + amounts.expected, received: sum.received + amounts.received, balance: sum.balance + amounts.balance }; }, { expected: 0, received: 0, balance: 0 });

  function exportCsv() {
    const extrato: ExtratoRow[] = rows.map(({ shift, obligation, placeName, expected, received, balance }) => ({
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
    }));
    downloadExtratoCsv(extratoFilename(), buildExtratoCsv(extrato));
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">MeuPlant\u00e3o</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Hist\u00f3rico financeiro</h1><p className="mt-1 text-slate-600">Acompanhe o previsto, o recebido e o saldo de cada plant\u00e3o.</p></div><button onClick={exportCsv} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Exportar CSV</button></header>
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm font-medium">De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium">At\u00e9<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label><label className="text-sm font-medium">Status<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="todos">Todos</option><option value="realizado">Realizado</option><option value="agendado">Agendado</option><option value="cancelado">Cancelado</option></select></label><label className="text-sm font-medium">Local<select value={place} onChange={(event) => setPlace(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="todos">Todos</option>{places.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label><label className="text-sm font-medium sm:col-span-2 lg:col-span-1">Buscar local<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: Hospital" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label></section>
    <section className="grid gap-3 sm:grid-cols-3"><Metric label="Total previsto" value={money.format(totals.expected)} /><Metric label="Total recebido" value={money.format(totals.received)} /><Metric label="Saldo restante" value={money.format(totals.balance)} /></section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">{rows.length} {rows.length === 1 ? "plant\u00e3o encontrado" : "plant\u00f5es encontrados"}</div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Local</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Previsto</th><th className="px-4 py-3 text-right">Recebido</th><th className="px-4 py-3 text-right">Saldo</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map(({ shift, obligation, placeName, received, balance }) => <tr key={shift.id} className="hover:bg-slate-50"><td className="px-4 py-3">{date(obligation?.data_prevista ?? shift.data)}</td><td className="px-4 py-3 font-medium">{placeName}</td><td className="px-4 py-3 capitalize">{shift.status}</td><td className="px-4 py-3 text-right">{money.format(shift.status === "realizado" ? Number(obligation?.valor_devido ?? 0) : 0)}</td><td className="px-4 py-3 text-right text-emerald-700">{money.format(received)}</td><td className="px-4 py-3 text-right font-semibold">{money.format(balance)}</td></tr>)}</tbody></table></div>{rows.length === 0 && <p className="px-4 py-10 text-center text-slate-500">Nenhum plant\u00e3o corresponde aos filtros.</p>}</section>
  </div></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>; }
