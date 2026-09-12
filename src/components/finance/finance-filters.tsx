"use client";

import { ALL_PERIODS, ALL_PLACES, isMonthValue } from "@/lib/finance-filters";
import type { Place } from "@/lib/places";
import { Button } from "@/components/ui/button";

type Props = {
  period: string;
  placeId: string;
  places: Place[];
  onPeriodChange: (next: string) => void;
  onPlaceChange: (next: string) => void;
};

export function FinanceFilters({ period, placeId, places, onPeriodChange, onPlaceChange }: Props) {
  const showingAll = period === ALL_PERIODS;
  return (
    <section aria-label="Filtros de periodo e local" className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1 text-sm font-medium">
          <label htmlFor="finance-period">Periodo</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="finance-period"
              type="month"
              className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-normal sm:max-w-44"
              value={showingAll ? "" : period}
              onChange={(event) => {
                const next = event.target.value;
                if (isMonthValue(next)) onPeriodChange(next);
              }}
              aria-label="Selecionar mes e ano"
            />
            <Button type="button" size="sm" variant={showingAll ? "default" : "outline"} onClick={() => onPeriodChange(ALL_PERIODS)} aria-pressed={showingAll}>
              Todos
            </Button>
          </div>
        </div>
        <div className="grid flex-1 gap-1 text-sm font-medium">
          <label htmlFor="finance-place">Local de trabalho</label>
          <select
            id="finance-place"
            className="h-9 w-full rounded-lg border bg-background px-3 font-normal"
            value={placeId}
            onChange={(event) => onPlaceChange(event.target.value)}
          >
            <option value={ALL_PLACES}>Todos os locais</option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.nome}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
