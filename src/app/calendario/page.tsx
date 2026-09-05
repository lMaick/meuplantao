"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { Button } from "@/components/ui/button";
import { listPlaces, type Place } from "@/lib/places";
import { listShifts, type Shift } from "@/lib/shifts";

export default function CalendarPage() {
  const [data, setData] = useState<{ places: Place[]; shifts: Shift[] } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const [places, shifts] = await Promise.all([listPlaces(), listShifts()]);
      setData({ places, shifts });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; };
  }, []);

  if (loading) return <main className="p-6"><p role="status">Carregando seu calendário...</p></main>;
  if (error || !data) return <main className="space-y-4 p-6"><h1 className="text-2xl font-bold">Calendário</h1><p role="alert">Não foi possível carregar seus plantões e locais.</p><Button onClick={() => void load()}>Tentar novamente</Button></main>;
  if (data.places.length === 0) return <main className="mx-auto max-w-xl space-y-4 px-5 py-8"><h1 className="text-2xl font-bold">Cadastre seu primeiro local</h1><p>Para criar um plantão, primeiro informe onde você trabalha. Depois, volte ao calendário para escolher a data e o horário.</p><Link href="/locais" className="inline-block rounded-lg bg-primary px-4 py-3 text-primary-foreground underline">Cadastrar local de trabalho</Link><Link href="/dashboard" className="block py-3 underline">Voltar ao resumo</Link></main>;
  return <><nav aria-label="Acesso rápido" className="flex gap-6 px-5 py-3"><Link href="/dashboard" className="py-2 underline">Resumo</Link><Link href="/locais" className="py-2 underline">Locais de trabalho</Link></nav><ShiftCalendar initialShifts={data.shifts} places={data.places} /></>;
}
