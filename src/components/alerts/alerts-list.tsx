"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2 } from "lucide-react";
import { listAlerts, type Alert } from "@/lib/alerts";

export function AlertsList() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAlerts().then(setAlerts).catch(() => setError("Não foi possível carregar seus alertas."));
  }, []);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!alerts) return <p className="text-sm text-zinc-500">Carregando alertas...</p>;
  if (alerts.length === 0) return <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-600" /><h2 className="text-lg font-semibold">Tudo em dia</h2><p className="text-sm text-zinc-500">Não há atrasos ou plantões nos próximos 7 dias.</p></div>;

  return <div className="space-y-3">{alerts.map((alert) => <article key={alert.id} className="flex gap-4 rounded-xl border bg-white p-4 shadow-sm"><div className={`mt-0.5 rounded-full p-2 ${alert.kind === "atraso" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{alert.kind === "atraso" ? <AlertCircle className="h-5 w-5" /> : <CalendarClock className="h-5 w-5" />}</div><div><h2 className="font-semibold text-zinc-900">{alert.title}</h2><p className="mt-1 text-sm text-zinc-600">{alert.description}</p></div></article>)}</div>;
}
