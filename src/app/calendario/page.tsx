"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, MapPin, Plus } from "lucide-react";
import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { Button, buttonVariants } from "@/components/ui/button";
import { CalendarSkeleton } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/ui/empty-state";
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
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <CalendarSkeleton />;
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <EmptyState
          icon={AlertCircle}
          title="Erro ao carregar calendário"
          description="Não foi possível carregar seus plantões e locais de trabalho. Verifique sua conexão e tente novamente."
          action={
            <Button onClick={() => void load()} variant="default">
              Tentar novamente
            </Button>
          }
        />
      </main>
    );
  }

  if (data.places.length === 0) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <EmptyState
          icon={MapPin}
          title="Cadastre seu primeiro local"
          description="Para criar um plantão, primeiro informe onde você trabalha. Depois, volte ao calendário para escolher a data e o horário."
          action={
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/locais"
                className={buttonVariants({ variant: "default" })}
              >
                <Plus className="size-4" />
                Cadastrar local de trabalho
              </Link>
              <Link
                href="/dashboard"
                className={buttonVariants({ variant: "outline" })}
              >
                Voltar ao resumo
              </Link>
            </div>
          }
        />
      </main>
    );
  }

  return (
    <>
      <nav
        aria-label="Acesso rápido"
        className="flex gap-6 border-b border-border/40 bg-card/50 px-5 py-3 text-sm"
      >
        <Link
          href="/dashboard"
          className="py-2 text-muted-foreground transition-colors hover:text-foreground hover:underline"
        >
          Resumo
        </Link>
        <Link
          href="/locais"
          className="py-2 text-muted-foreground transition-colors hover:text-foreground hover:underline"
        >
          Locais de trabalho
        </Link>
      </nav>
      <ShiftCalendar initialShifts={data.shifts} places={data.places} />
    </>
  );
}
