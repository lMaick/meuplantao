"use client";

import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Badge } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "cn";
import { removeShift, saveShiftWithObligation, type Shift, type ShiftStatus } from "@/lib/shifts";
import { ShiftCreationIntent, keyForShiftSave } from "@/lib/shifts/idempotency";
import { listObligations, type Obligation } from "@/lib/obligations";
import type { Place } from "@/lib/places";
import { listContacts, type Contact } from "@/lib/contacts";

const months = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const week = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekShort = ["D", "S", "T", "Q", "Q", "S", "S"];

const labels: Record<ShiftStatus, string> = {
  agendado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
};

const colors: Record<ShiftStatus, string> = {
  agendado: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/20",
  realizado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20",
  cancelado: "bg-muted text-muted-foreground border border-border/50",
};

const iso = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function ShiftCalendar({
  initialShifts,
  places,
  initialOpen = false,
}: {
  initialShifts: Shift[];
  places: Place[];
  initialOpen?: boolean;
}) {
  const today = new Date();
  const query = useSearchParams();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(iso(today));
  const [shifts, setShifts] = useState(initialShifts);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [filter, setFilter] = useState<ShiftStatus | "todos">("todos");
  const [editing, setEditing] = useState<Shift | null | false>(
    initialOpen || query.get("novo") === "1" ? null : false
  );
  const [intent, setIntent] = useState<ShiftCreationIntent | null>(() =>
    initialOpen || query.get("novo") === "1" ? ShiftCreationIntent.begin() : null
  );

  function openNew() {
    setIntent(ShiftCreationIntent.begin());
    setEditing(null);
  }

  function closeForm() {
    intent?.markCancelled();
    setIntent(null);
    setEditing(false);
  }

  useEffect(() => {
    void Promise.all([listContacts(), listObligations()]).then(([nextContacts, nextObligations]) => {
      setContacts(nextContacts);
      setObligations(nextObligations);
      const editId = query.get("editar");
      const editShift = editId ? initialShifts.find((shift) => shift.id === editId) : undefined;
      if (editShift) setEditing(editShift);
    });
  }, [initialShifts, query]);

  const days = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((start + count) / 7) * 7 }, (_, i) =>
      i < start || i >= start + count
        ? null
        : new Date(cursor.getFullYear(), cursor.getMonth(), i - start + 1)
    );
  }, [cursor]);

  const visible = shifts.filter((s) => filter === "todos" || s.status === filter);
  const selectedShifts = visible
    .filter((s) => s.data === selected)
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

  const name = (id: string) => places.find((p) => p.id === id)?.nome ?? "Local não encontrado";

  async function save(data: FormData) {
    const status = String(data.get("status")) as ShiftStatus;
    const rawValue = String(data.get("valor_previsto") ?? "").trim();
    const value = rawValue === "" ? null : Number(rawValue);
    const responsibleType = String(data.get("responsavel_tipo") ?? "");
    const responsibleId = String(data.get("responsavel_id") ?? "");
    const dueDate = String(data.get("data_prevista") ?? "");

    const validResponsible =
      responsibleType === "local"
        ? places.some((place) => place.id === responsibleId)
        : responsibleType === "contato"
        ? contacts.some((contact) => contact.id === responsibleId)
        : false;

    const input = {
      place_id: String(data.get("place_id")),
      data: String(data.get("data")),
      hora_inicio: String(data.get("hora_inicio")),
      hora_fim: String(data.get("hora_fim")),
      valor_previsto: value,
      status,
    };

    if (
      status === "realizado" &&
      (value === null || !Number.isFinite(value) || value < 0 || !dueDate || !validResponsible)
    ) {
      throw new Error("Plantão realizado exige valor, data prevista e responsável.");
    }

    const isNew = !editing;
    const result = await saveShiftWithObligation(editing ? editing.id : null, {
      ...input,
      data_prevista: status === "realizado" ? dueDate : null,
      responsavel_place_id: status === "realizado" && responsibleType === "local" ? responsibleId : null,
      responsavel_contact_id: status === "realizado" && responsibleType === "contato" ? responsibleId : null,
      idempotency_key: keyForShiftSave(isNew, intent),
    });

    setShifts((list) => (editing ? list.map((s) => (s.id === result.id ? result : s)) : [result, ...list]));
    setSelected(result.data);
    intent?.markSucceeded();
    setIntent(null);
    setEditing(false);
  }

  async function remove() {
    if (editing && !confirm("Excluir este plantão?")) return;
    if (editing) {
      await removeShift(editing.id);
      setShifts((list) => list.filter((s) => s.id !== editing.id));
      intent?.markCancelled();
      setIntent(null);
      setEditing(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Top Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">MeuPlantão</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Agenda de plantões</h1>
          </div>
          <Button onClick={openNew} className="min-h-[44px]">
            <Plus className="size-4" /> Novo plantão
          </Button>
        </div>
      </header>

      {/* Main Grid: Monthly Calendar + Day Agenda */}
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_340px]">
        {/* Month Calendar Section */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {/* Month Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Mês anterior"
                className="min-h-[44px] min-w-[44px]"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Próximo mês"
                className="min-h-[44px] min-w-[44px]"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
              <h2 className="ml-2 text-lg font-semibold tracking-tight">
                {months[cursor.getMonth()]}{" "}
                <span className="text-muted-foreground">{cursor.getFullYear()}</span>
              </h2>
            </div>
            <Button
              variant="ghost"
              className="min-h-[44px]"
              onClick={() => {
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelected(iso(today));
              }}
            >
              Hoje
            </Button>
          </div>

          {/* MOBILE COMPACT VIEW (< 768px): 7-col grid with dot badges */}
          <div className="mt-4 md:hidden">
            <div className="grid grid-cols-7 border-b border-border pb-2">
              {weekShort.map((day, idx) => (
                <div
                  key={idx}
                  className="text-center text-xs font-bold uppercase text-muted-foreground"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 pt-2">
              {days.map((day, i) => {
                if (!day) {
                  return (
                    <div
                      key={`empty-${i}`}
                      className="h-11 min-h-[44px] pointer-events-none"
                      aria-hidden="true"
                    />
                  );
                }
                const date = iso(day);
                const dayShifts = visible.filter((s) => s.data === date);
                const isSelected = date === selected;
                const isToday = date === iso(today);

                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelected(date)}
                    aria-label={`${day.getDate()} de ${months[day.getMonth()]}${
                      dayShifts.length > 0 ? `, ${dayShifts.length} plantões` : ""
                    }`}
                    aria-pressed={isSelected}
                    className={cn(
                      "h-11 min-h-[44px] w-full rounded-xl flex flex-col items-center justify-center p-1 relative transition-all touch-manipulation cursor-pointer",
                      isSelected
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : isToday
                        ? "bg-primary/10 text-primary font-bold ring-1 ring-primary/30 hover:bg-primary/20"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    <span className="text-sm leading-none">{day.getDate()}</span>
                    {/* Shift Dot Badges */}
                    <div className="flex items-center gap-0.5 mt-1 h-1.5 justify-center">
                      {dayShifts.slice(0, 3).map((s) => (
                        <span
                          key={s.id}
                          className={cn(
                            "size-1.5 rounded-full shrink-0",
                            isSelected
                              ? "bg-primary-foreground"
                              : s.status === "realizado"
                              ? "bg-emerald-500"
                              : s.status === "agendado"
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40"
                          )}
                        />
                      ))}
                      {dayShifts.length > 3 && (
                        <span
                          className={cn(
                            "text-[8px] font-bold leading-none shrink-0",
                            isSelected ? "text-primary-foreground" : "text-muted-foreground"
                          )}
                        >
                          +
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* DESKTOP EXPANDED VIEW (>= 768px): 7-col grid with text pills */}
          <div className="hidden md:grid grid-cols-7 border-l border-t border-border mt-6">
            {week.map((day) => (
              <div
                key={day}
                className="border-b border-r border-border bg-muted/40 p-2 text-center text-xs font-semibold uppercase text-muted-foreground"
              >
                {day}
              </div>
            ))}
            {days.map((day, i) => {
              const date = day && iso(day);
              const list = date ? visible.filter((s) => s.data === date) : [];
              const isSelected = date === selected;
              const isToday = date === iso(today);

              return (
                <button
                  key={i}
                  disabled={!day}
                  type="button"
                  onClick={() => date && setSelected(date)}
                  className={cn(
                    "min-h-24 border-b border-r border-border p-2 text-left align-top transition-colors touch-manipulation cursor-pointer hover:bg-muted/50",
                    isSelected && "bg-muted ring-2 ring-inset ring-primary",
                    !day && "cursor-default bg-muted/10 pointer-events-none"
                  )}
                >
                  {day && (
                    <>
                      <span
                        className={cn(
                          "inline-flex size-7 items-center justify-center rounded-full text-sm",
                          isToday
                            ? "bg-primary font-bold text-primary-foreground"
                            : isSelected
                            ? "font-bold text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {day.getDate()}
                      </span>
                      <div className="mt-1 space-y-1">
                        {list.slice(0, 2).map((s) => (
                          <div
                            key={s.id}
                            className={cn(
                              "truncate rounded px-1.5 py-0.5 text-[10px] font-semibold",
                              colors[s.status]
                            )}
                          >
                            {s.hora_inicio.slice(0, 5)} · {name(s.place_id)}
                          </div>
                        ))}
                        {list.length > 2 && (
                          <div className="text-[10px] font-medium text-muted-foreground px-1">
                            +{list.length - 2} mais
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Day Agenda Aside */}
        <aside className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Plantões do dia
              </p>
              <h2 className="mt-1 text-lg font-bold capitalize text-foreground">
                {new Date(`${selected}T12:00:00`).toLocaleDateString("pt-BR", {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                })}
              </h2>
            </div>
            <div className="rounded-xl bg-primary/10 p-2 text-primary ring-1 ring-primary/20 shrink-0">
              <CalendarDays className="size-5 shrink-0" />
            </div>
          </div>

          {/* Filter Pills (44px min touch target) */}
          <div className="flex gap-1 rounded-xl bg-muted/60 p-1 border border-border/50">
            {(["todos", "agendado", "realizado"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFilter(v)}
                className={cn(
                  "flex-1 h-10 min-h-[44px] rounded-lg px-2 text-xs font-semibold transition-all touch-manipulation cursor-pointer",
                  filter === v
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v === "todos" ? "Todos" : labels[v]}
              </button>
            ))}
          </div>

          {/* Agenda Shift List */}
          <div className="space-y-3">
            {selectedShifts.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Nenhum plantão neste dia"
                description="Não há plantões agendados ou realizados nesta data."
                compact
                action={
                  <Button variant="outline" size="sm" onClick={openNew} className="min-h-[44px] rounded-xl">
                    <Plus className="size-4" /> Adicionar plantão
                  </Button>
                }
              />
            ) : (
              selectedShifts.map((s) => {
                const isNight = s.hora_inicio >= "18:00" || s.hora_inicio < "06:00";
                const obl = obligations.find((item) => item.shift_id === s.id);
                const saldo = obl ? Math.max(0, Number(obl.saldo ?? 0)) : null;
                const isQuitado = obl && saldo === 0;

                return (
                  <div
                    key={s.id}
                    className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md space-y-3"
                  >
                    <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <h3 className="font-bold text-foreground text-base leading-snug">
                          {name(s.place_id)}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />
                            <span>
                              {s.hora_inicio.slice(0, 5)} – {s.hora_fim.slice(0, 5)}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                            {isNight ? (
                              <Moon className="size-3 text-indigo-500" />
                            ) : (
                              <Sun className="size-3 text-amber-500" />
                            )}
                            <span>{isNight ? "Noturno" : "Diurno"}</span>
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Editar plantão em ${name(s.place_id)}`}
                        onClick={() => setEditing(s)}
                        className="min-h-[44px] min-w-[44px]"
                      >
                        <Pencil className="size-4 text-muted-foreground" />
                      </Button>
                    </div>

                    {s.valor_previsto !== null && (
                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-muted-foreground">Valor do plantão:</span>
                        <span className="font-mono font-bold text-foreground">
                          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                            Number(s.valor_previsto)
                          )}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            s.status === "realizado"
                              ? "success"
                              : s.status === "agendado"
                              ? "warning"
                              : "neutral"
                          }
                          dot
                        >
                          {labels[s.status]}
                        </Badge>
                        {s.status === "realizado" && isQuitado && (
                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-500/20">
                            Quitado
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/calendario/plantao/${s.id}`}
                        className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary hover:underline py-1"
                      >
                        Ver ficha
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <Button className="w-full min-h-[44px]" variant="outline" onClick={openNew}>
            <Plus className="size-4" /> Adicionar neste dia
          </Button>
        </aside>
      </div>

      {/* Modal Form */}
      {editing !== false && (
        <Form
          shift={editing || undefined}
          obligation={editing ? obligations.find((item) => item.shift_id === editing.id) : undefined}
          places={places}
          contacts={contacts}
          date={selected}
          close={closeForm}
          save={save}
          remove={remove}
        />
      )}
    </main>
  );
}

function Form({
  shift,
  obligation,
  places,
  contacts,
  date,
  close,
  save,
  remove,
}: {
  shift?: Shift;
  obligation?: Obligation;
  places: Place[];
  contacts: Contact[];
  date: string;
  close: () => void;
  save: (data: FormData) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialResponsibleType = obligation?.responsavel_contact_id
    ? "contato"
    : obligation?.responsavel_place_id
      ? "local"
      : "";
  const [status, setStatus] = useState<ShiftStatus>(shift?.status ?? "agendado");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [responsibleType, setResponsibleType] = useState<"" | "local" | "contato">(
    initialResponsibleType
  );
  const [responsibleId, setResponsibleId] = useState(
    obligation?.responsavel_contact_id ?? obligation?.responsavel_place_id ?? ""
  );

  const isBecomingCanceled = status === "cancelado" && (!shift || shift.status !== "cancelado");

  function handleStatusChange(newStatus: ShiftStatus) {
    setStatus(newStatus);
    if (newStatus !== "cancelado") {
      setConfirmCancel(false);
    }
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-xs sm:items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={shift ? "Editar plantão" : "Novo plantão"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) close();
          if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input:not(:disabled), select:not(:disabled)"
              )
            );
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (isBecomingCanceled && !confirmCancel) {
            setConfirmCancel(true);
            return;
          }
          const data = new FormData(event.currentTarget);
          void run(() => save(data));
        }}
        className="max-h-[90dvh] overflow-y-auto w-full max-w-md rounded-t-2xl border border-border bg-card p-5 sm:p-6 shadow-xl text-card-foreground sm:rounded-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        {/* Mobile handle indicator */}
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-muted-foreground/30 sm:hidden" />

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            {shift ? "Editar plantão" : "Novo plantão"}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            aria-label="Fechar"
            className="inline-flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <fieldset disabled={busy} className="mt-5 grid gap-5">
          <div className="grid gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Quando e onde?</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Informe o local e o horário do plantão.
              </p>
            </div>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            <span>Local</span>
            {places.length === 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-destructive">Nenhum local cadastrado.</p>
                <Link
                  href="/locais"
                  className="inline-block text-xs font-semibold text-primary underline"
                >
                  Cadastrar local agora
                </Link>
              </div>
            ) : (
              <Select name="place_id" autoFocus required defaultValue={shift?.place_id ?? places[0]?.id}>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            )}
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            <span>Data</span>
            <Input name="data" type="date" required defaultValue={shift?.data ?? date} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              <span>Início</span>
              <Input
                name="hora_inicio"
                type="time"
                required
                defaultValue={shift?.hora_inicio}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              <span>Fim</span>
              <Input
                name="hora_fim"
                type="time"
                required
                defaultValue={shift?.hora_fim}
              />
            </label>
          </div>

          </div>

          <div className="grid gap-3 border-t border-border pt-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Valor e recebimento</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                O valor pode ser planejado agora. Os dados de recebimento entram quando o plantão for realizado.
              </p>
            </div>

          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            <span>Valor do plantão (R$)</span>
            <Input
              name="valor_previsto"
              type="number"
              min="0"
              step="0.01"
              placeholder="0,00"
              defaultValue={obligation?.valor_devido ?? shift?.valor_previsto ?? ""}
            />
          </label>

          {status === "realizado" && (
            <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Preencha estes dados para acompanhar o recebimento deste plantão.
              </p>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            <span>Quando você espera receber?</span>
            <Input
              name="data_prevista"
              type="date"
              required
              defaultValue={obligation?.data_prevista ?? ""}
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            <span>Tipo de responsável</span>
            <Select
              name="responsavel_tipo"
              value={responsibleType}
              required
              onChange={(event) => {
                setResponsibleType(event.target.value as "" | "local" | "contato");
                setResponsibleId("");
              }}
            >
              <option value="">Selecione...</option>
              <option value="local">O próprio local</option>
              <option value="contato">Uma pessoa de contato</option>
            </Select>
            <span className="text-xs font-normal leading-relaxed text-muted-foreground">
              Primeiro escolha o tipo para ver as opções corretas.
            </span>
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            <span>Responsável pelo repasse</span>
            <Select
              name="responsavel_id"
              value={responsibleId}
              required
              disabled={!responsibleType}
              onChange={(event) => setResponsibleId(event.target.value)}
            >
              <option value="">
                {responsibleType ? "Selecione..." : "Escolha o tipo primeiro"}
              </option>
              {responsibleType === "local" && places.map((p) => (
                <option key={`place-${p.id}`} value={p.id}>
                  {p.nome}
                </option>
              ))}
              {responsibleType === "contato" && contacts.map((c) => (
                <option key={`contact-${c.id}`} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </label>
            </div>
          )}

          <div className="grid gap-3 border-t border-border pt-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Situação do plantão</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Defina se o plantão está agendado, se já foi realizado ou se foi cancelado.
              </p>
            </div>

            <Input type="hidden" name="status" value={status} />

            <div
              role="radiogroup"
              aria-label="Situação do plantão"
              className="grid grid-cols-3 gap-2"
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const options: ShiftStatus[] = ["agendado", "realizado", "cancelado"];
                  const currentIndex = options.indexOf(status);
                  const nextIndex = (currentIndex + 1) % options.length;
                  handleStatusChange(options[nextIndex]);
                  const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='radio']");
                  buttons[nextIndex]?.focus();
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const options: ShiftStatus[] = ["agendado", "realizado", "cancelado"];
                  const currentIndex = options.indexOf(status);
                  const nextIndex = (currentIndex - 1 + options.length) % options.length;
                  handleStatusChange(options[nextIndex]);
                  const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='radio']");
                  buttons[nextIndex]?.focus();
                }
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={status === "agendado"}
                tabIndex={status === "agendado" ? 0 : -1}
                onClick={() => handleStatusChange("agendado")}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-semibold transition-all duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer",
                  status === "agendado"
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-200 ring-2 ring-amber-500/25 shadow-xs"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <CalendarDays className={cn("size-4 shrink-0", status === "agendado" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
                <span>Agendado</span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={status === "realizado"}
                tabIndex={status === "realizado" ? 0 : -1}
                onClick={() => handleStatusChange("realizado")}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-semibold transition-all duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer",
                  status === "realizado"
                    ? "border-emerald-600/60 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/25 shadow-xs"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <CheckCircle2 className={cn("size-4 shrink-0", status === "realizado" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
                <span>Realizado</span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={status === "cancelado"}
                tabIndex={status === "cancelado" ? 0 : -1}
                onClick={() => handleStatusChange("cancelado")}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-semibold transition-all duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive cursor-pointer",
                  status === "cancelado"
                    ? "border-destructive/60 bg-destructive/10 text-destructive dark:text-rose-200 ring-2 ring-destructive/25 shadow-xs"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Ban className={cn("size-4 shrink-0", status === "cancelado" ? "text-destructive" : "text-muted-foreground")} />
                <span>Cancelado</span>
              </button>
            </div>

            <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {status === "agendado" && "O plantão ainda vai acontecer conforme o planejamento."}
              {status === "realizado" && "O plantão aconteceu e gera previsão de repasse financeiro."}
              {status === "cancelado" && "O plantão não aconteceu e não gerará previsão de repasse financeiro."}
            </div>
          </div>
          </div>
        </fieldset>

        {isBecomingCanceled && confirmCancel && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive animate-in fade-in duration-200"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 shrink-0 mt-0.5 text-destructive" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-destructive">
                  Confirmar cancelamento do plantão?
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Marcar como cancelado indica que o plantão não foi realizado. Nenhuma obrigação financeira ou recebimento será gerado.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {shift ? (
            <Button
              type="button"
              variant="destructive"
              size="default"
              disabled={busy}
              onClick={() => void run(remove)}
              className="min-h-[44px] w-full sm:w-auto"
            >
              <Trash2 className="size-4" />
              <span>Excluir plantão</span>
            </Button>
          ) : (
            <span className="hidden sm:inline-block" />
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {isBecomingCanceled && confirmCancel ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Voltar
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="default"
                  disabled={busy}
                  className="min-h-[44px] w-full sm:w-auto font-semibold"
                >
                  {busy ? "Cancelando..." : "Confirmar cancelamento"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  disabled={busy}
                  onClick={close}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  Fechar
                </Button>
                <Button
                  type="submit"
                  size="default"
                  disabled={busy}
                  className="min-h-[44px] w-full sm:w-auto font-semibold"
                >
                  {busy ? "Salvando..." : "Salvar alterações"}
                </Button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
