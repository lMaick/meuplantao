import { cn } from "cn";
import { Skeleton } from "./primitives";

/**
 * Generic content card skeleton
 */
export function CardSkeleton({
  className,
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      role="status"
      aria-label="Carregando cartão..."
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4", className)}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-36 rounded-md" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
      <div className="space-y-2 pt-1">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-4 rounded", i === lines - 1 ? "w-2/3" : "w-full")}
          />
        ))}
      </div>
      <div className="flex items-center justify-between pt-2">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Dashboard view skeleton: metric cards + alert banner skeleton
 */
export function DashboardSkeleton() {
  return (
    <main
      role="status"
      aria-label="Carregando resumo financeiro..."
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-8 w-56 sm:w-72 rounded-lg" />
            <Skeleton className="h-4 w-64 sm:w-96 rounded" />
          </div>
          <Skeleton className="h-10 w-28 rounded-lg shrink-0" />
        </header>

        {/* Quick Nav Pills */}
        <div className="flex flex-wrap gap-4">
          <Skeleton className="h-11 w-44 rounded-lg" />
          <Skeleton className="h-11 w-52 rounded-lg" />
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-11 w-40 rounded-lg" />
          <Skeleton className="h-11 w-24 rounded-lg" />
          <Skeleton className="h-11 w-48 rounded-lg" />
        </div>

        {/* Alert banner skeleton */}
        <div className="rounded-2xl border border-border/80 bg-muted/40 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <Skeleton className="size-11 rounded-xl shrink-0" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-44 rounded-full" />
                  <Skeleton className="h-5 w-36 rounded-full" />
                </div>
                <Skeleton className="h-6 w-64 sm:w-80 rounded" />
                <Skeleton className="h-4 w-72 sm:w-96 rounded" />
              </div>
            </div>
            <Skeleton className="h-11 w-full sm:w-40 rounded-xl shrink-0" />
          </div>
        </div>

        {/* KPI metrics cards (4 grid items) */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24 rounded" />
                <Skeleton className="size-5 rounded-md" />
              </div>
              <Skeleton className="h-8 w-36 rounded-lg" />
            </div>
          ))}
        </section>

        {/* 2 Split cards: Recebimentos pendentes & Próximos 7 dias */}
        <section className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, cardIndex) => (
            <div key={cardIndex} className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5">
              <div className="flex items-center gap-2">
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-6 w-48 rounded" />
              </div>
              <div className="divide-y divide-border">
                {Array.from({ length: 3 }).map((_, itemIndex) => (
                  <div key={itemIndex} className="flex items-center justify-between py-3.5">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-40 rounded" />
                      <Skeleton className="h-4 w-52 rounded" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="h-8 w-24 rounded-md shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

/**
 * Calendar view skeleton: month header + day agenda list skeleton
 */
export function CalendarSkeleton() {
  return (
    <main
      role="status"
      aria-label="Carregando agenda de plantões..."
      className="min-h-screen bg-background text-foreground"
    >
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="space-y-1">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-7 w-48 rounded-lg" />
          </div>
          <Skeleton className="h-11 w-36 rounded-lg" />
        </div>
      </header>

      {/* Main Grid: Calendar + Day Agenda */}
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[1fr_340px]">
        {/* Monthly Calendar box */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="size-10 rounded-lg" />
              <Skeleton className="size-10 rounded-lg" />
              <Skeleton className="h-6 w-36 rounded ml-2" />
            </div>
            <Skeleton className="h-9 w-16 rounded-lg" />
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 border-l border-t border-border">
            {/* Weekday headers */}
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="border-b border-r border-border bg-muted/40 p-2 text-center">
                <Skeleton className="mx-auto h-3 w-6 rounded" />
              </div>
            ))}
            {/* 35 Calendar day cells */}
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="min-h-20 sm:min-h-24 border-b border-r border-border p-2 space-y-1.5">
                <Skeleton className="size-6 rounded-full" />
                {i % 4 === 0 && <Skeleton className="h-4 w-full rounded" />}
                {i % 7 === 2 && <Skeleton className="h-4 w-4/5 rounded" />}
              </div>
            ))}
          </div>
        </section>

        {/* Day Agenda sidebar */}
        <aside className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-6 w-44 rounded-lg" />
            </div>
            <Skeleton className="size-6 rounded" />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <Skeleton className="h-7 flex-1 rounded-md" />
            <Skeleton className="h-7 flex-1 rounded-md" />
            <Skeleton className="h-7 flex-1 rounded-md" />
          </div>

          {/* Agenda items list */}
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-5 w-32 rounded" />
                    <Skeleton className="h-4 w-24 rounded" />
                  </div>
                  <Skeleton className="size-4 rounded" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>

          {/* Add button */}
          <Skeleton className="h-11 w-full rounded-lg" />
        </aside>
      </div>
    </main>
  );
}

/**
 * Payments view skeleton: totalizers + obligation list skeleton
 */
export function PaymentsSkeleton() {
  return (
    <main
      role="status"
      aria-label="Carregando recebimentos..."
      className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6"
    >
      {/* Header */}
      <header className="space-y-2">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-8 w-44 rounded-lg" />
        <Skeleton className="h-4 w-80 rounded" />
      </header>

      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-40 rounded-lg" />
          <Skeleton className="h-11 w-48 rounded-lg" />
        </div>
      </div>

      {/* Totalizers (3 metric cards) */}
      <section className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-7 w-36 rounded-lg" />
          </div>
        ))}
      </section>

      {/* Register payment form skeleton */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <Skeleton className="h-6 w-44 rounded" />
        <div className="grid gap-4 sm:grid-cols-[1fr_150px_170px_auto] sm:items-end">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-28 rounded-lg" />
        </div>
      </section>

      {/* Receivables list section */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <Skeleton className="h-6 w-32 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-16 rounded-lg" />
            <Skeleton className="h-9 w-20 rounded-lg" />
            <Skeleton className="h-9 w-20 rounded-lg" />
            <Skeleton className="h-9 w-16 rounded-lg" />
          </div>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <article key={i} className="rounded-xl border border-border bg-card p-5 space-y-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28 rounded" />
                  <Skeleton className="h-5 w-44 rounded" />
                  <Skeleton className="h-4 w-52 rounded" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-16 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-14 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-16 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
                <Skeleton className="h-5 w-32 rounded" />
                <Skeleton className="h-4 w-20 rounded" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

/**
 * History view skeleton: filter bar + card/table list skeleton
 */
export function HistorySkeleton() {
  return (
    <main
      role="status"
      aria-label="Carregando histórico financeiro..."
      className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-8 w-56 rounded-lg" />
            <Skeleton className="h-4 w-72 sm:w-96 rounded" />
          </div>
          <Skeleton className="h-11 w-36 rounded-lg" />
        </header>

        {/* Filter Bar: 5 fields */}
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={cn("space-y-1.5", i === 4 ? "sm:col-span-2 lg:col-span-1" : "")}>
              <Skeleton className="h-3.5 w-12 rounded" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </div>
          ))}
        </section>

        {/* 3 Metric cards */}
        <section className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-7 w-32 rounded-lg" />
            </div>
          ))}
        </section>

        {/* Content list / table skeleton */}
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-4 w-36 rounded" />
          </div>

          {/* Desktop Table Skeleton (hidden on mobile) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  {["Data", "Local", "Status", "Previsto", "Recebido", "Saldo"].map((col) => (
                    <th key={col} className="px-4 py-3">
                      <Skeleton className="h-3.5 w-14 rounded" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3.5"><Skeleton className="h-4 w-20 rounded" /></td>
                    <td className="px-4 py-3.5"><Skeleton className="h-4 w-36 rounded" /></td>
                    <td className="px-4 py-3.5"><Skeleton className="h-5 w-20 rounded-full" /></td>
                    <td className="px-4 py-3.5"><Skeleton className="ml-auto h-4 w-20 rounded" /></td>
                    <td className="px-4 py-3.5"><Skeleton className="ml-auto h-4 w-20 rounded" /></td>
                    <td className="px-4 py-3.5"><Skeleton className="ml-auto h-4 w-20 rounded" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Skeleton (< 640px) */}
          <div className="divide-y divide-border sm:hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-5 w-44 rounded" />
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-full rounded" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
