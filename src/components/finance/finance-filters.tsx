"use client";

import { Calendar, Building2 } from "lucide-react";
import { ALL_PERIODS, ALL_PLACES, isMonthValue } from "@/lib/finance-filters";
import type { Place } from "@/lib/places";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/primitives";

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
    <section
      aria-label="Filtros de período e local"
      className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs text-card-foreground"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-1.5 text-sm font-medium">
          <label htmlFor="finance-period" className="flex items-center gap-1.5 font-semibold text-foreground">
            <Calendar className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>Período</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="finance-period"
              type="month"
              className="h-11 min-h-[44px] min-w-0 flex-1 rounded-lg border border-input bg-background px-3.5 text-base font-normal sm:max-w-48 md:text-sm"
              value={showingAll ? "" : period}
              onChange={(event) => {
                const next = event.target.value;
                if (isMonthValue(next)) onPeriodChange(next);
              }}
              aria-label="Selecionar mês e ano"
            />
            <Button
              type="button"
              variant={showingAll ? "default" : "outline"}
              className="h-11 min-h-[44px] px-4 font-medium"
              onClick={() => onPeriodChange(ALL_PERIODS)}
              aria-pressed={showingAll}
            >
              Todos
            </Button>
          </div>
        </div>
        <div className="grid flex-1 gap-1.5 text-sm font-medium">
          <label htmlFor="finance-place" className="flex items-center gap-1.5 font-semibold text-foreground">
            <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>Local de trabalho</span>
          </label>
          <Select
            id="finance-place"
            className="h-11 min-h-[44px] w-full rounded-lg border border-input bg-background px-3.5 text-base font-normal md:text-sm"
            value={placeId}
            onChange={(event) => onPlaceChange(event.target.value)}
            aria-label="Filtrar por local de trabalho"
          >
            <option value={ALL_PLACES}>Todos os locais</option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.nome}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </section>
  );
}

