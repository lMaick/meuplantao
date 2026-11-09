"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarCheck, Check, Hospital, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveShiftWithObligation, type Shift } from "@/lib/shifts";
import { listPendingConfirmations } from "@/lib/shifts/pending-confirmation";
import { resolveRealizedDefaults } from "@/lib/shifts/place-defaults";
import { canCreateShift, useSubscription } from "@/lib/subscription";
import type { Place } from "@/lib/places";
import { cn } from "cn";

const MAX_VISIBLE = 5;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

type Props = {
  shifts: Shift[];
  places: Place[];
  /** "Hoje" no fuso da aplicação (America/Bahia), definido pelo chamador. */
  todayIso: string;
  /** Chamado com o plantão salvo pelo RPC, para o dashboard atualizar totais. */
  onSaved: (saved: Shift) => void;
};

export function PendingConfirmation({ shifts, places, todayIso, onSaved }: Props) {
  const router = useRouter();
  const { trial } = useSubscription();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = useMemo(() => listPendingConfirmations(shifts, todayIso), [shifts, todayIso]);
  const placesById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);

  if (pending.length === 0) return null;

  const visible = pending.slice(0, MAX_VISIBLE);
  const hidden = pending.length - visible.length;
  const blocked = trial ? !canCreateShift(trial) : false;

  function setLeavingFor(id: string, value: boolean) {
    setLeaving((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function commit(shift: Shift, payload: Parameters<typeof saveShiftWithObligation>[1]) {
    // Clique duplo: o item some (otimista) e fica sem botões até o RPC responder.
    if (leaving.has(shift.id)) return;
    setErrors((current) => {
      const { [shift.id]: _removed, ...rest } = current;
      void _removed;
      return rest;
    });
    setConfirmingId(null);
    setLeavingFor(shift.id, true);
    try {
      const saved = await saveShiftWithObligation(shift.id, payload);
      onSaved(saved);
    } catch {
      // Restaura o item e avisa.
      setLeavingFor(shift.id, false);
      setErrors((current) => ({
        ...current,
        [shift.id]: "Não foi possível salvar o plantão. Tente novamente.",
      }));
    }
  }

  function handleHappened(shift: Shift) {
    if (blocked) {
      router.push("/assinatura");
      return;
    }
    const place = placesById.get(shift.place_id);
    if (!place) {
      router.push(`/calendario?editar=${shift.id}`);
      return;
    }
    const defaults = resolveRealizedDefaults(shift, place);
    const valor = defaults.valor === null ? null : Number(defaults.valor);
    if (!defaults.completo || valor === null || !Number.isFinite(valor) || valor <= 0) {
      // Falta valor ou prazo, ou o valor é zero: o formulário completo confirma.
      router.push(`/calendario?editar=${shift.id}`);
      return;
    }
    void commit(shift, {
      place_id: shift.place_id,
      data: shift.data,
      hora_inicio: shift.hora_inicio,
      hora_fim: shift.hora_fim,
      valor_previsto: valor,
      status: "realizado",
      data_prevista: defaults.dataPrevista,
      responsavel_place_id: defaults.responsavelTipo === "local" ? defaults.responsavelId : null,
      responsavel_contact_id: defaults.responsavelTipo === "contato" ? defaults.responsavelId : null,
      idempotency_key: null,
    });
  }

  function handleDidNotHappen(shift: Shift) {
    if (blocked) {
      router.push("/assinatura");
      return;
    }
    void commit(shift, {
      place_id: shift.place_id,
      data: shift.data,
      hora_inicio: shift.hora_inicio,
      hora_fim: shift.hora_fim,
      valor_previsto: shift.valor_previsto ?? null,
      status: "cancelado",
      data_prevista: null,
      responsavel_place_id: null,
      responsavel_contact_id: null,
      idempotency_key: null,
    });
  }

  return (
    <section aria-labelledby="pending-confirmation-title" className="motion-safe:animate-[success-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
      <Card className="border-amber-500/30 bg-amber-500/5 p-4 shadow-xs sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="rounded-lg bg-amber-500/15 p-1.5 text-amber-800 dark:text-amber-300">
            <CalendarCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 id="pending-confirmation-title" className="font-bold tracking-tight text-foreground">
              Esses plantões aconteceram?
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Confirme para o valor entrar no seu painel de recebimentos.
            </p>
          </div>
        </div>

        <ul className="divide-y divide-border">
          {visible.map((shift) => {
            const isLeaving = leaving.has(shift.id);
            const isConfirming = confirmingId === shift.id;
            const error = errors[shift.id];
            return (
              <li
                key={shift.id}
                aria-hidden={isLeaving || undefined}
                className={cn(
                  "overflow-hidden transition-[opacity,max-height] duration-150 ease-out motion-reduce:transition-none",
                  isLeaving ? "pointer-events-none max-h-0 opacity-0" : "max-h-60 opacity-100"
                )}
              >
                <div className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 shrink-0 rounded-xl bg-primary/10 p-2 text-primary ring-1 ring-primary/20">
                      <Hospital className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {placesById.get(shift.place_id)?.nome ?? "Local não informado"}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {dateFormat.format(new Date(`${shift.data}T12:00:00`))} · {shift.hora_inicio.slice(0, 5)}–
                        {shift.hora_fim.slice(0, 5)}
                      </p>
                    </div>
                  </div>

                  {isConfirming ? (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar cancelamento">
                      <span className="text-sm font-medium text-foreground">Marcar como não realizado?</span>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isLeaving}
                        onClick={() => handleDidNotHappen(shift)}
                        className="min-h-[44px] min-w-[44px] rounded-xl border-destructive/50 font-semibold text-destructive"
                      >
                        Sim, cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={isLeaving}
                        onClick={() => setConfirmingId(null)}
                        className="min-h-[44px] min-w-[44px] rounded-xl font-semibold"
                      >
                        Voltar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        disabled={isLeaving}
                        onClick={() => handleHappened(shift)}
                        className="min-h-[44px] min-w-[44px] rounded-xl font-semibold"
                      >
                        <Check className="mr-1.5 size-4" />
                        Aconteceu
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isLeaving}
                        onClick={() => setConfirmingId(shift.id)}
                        className="min-h-[44px] min-w-[44px] rounded-xl font-semibold"
                      >
                        <X className="mr-1.5 size-4" />
                        Não aconteceu
                      </Button>
                    </div>
                  )}
                </div>
                {error && (
                  <p role="alert" className="pb-3 text-sm font-medium text-destructive">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {hidden > 0 && (
          <Link
            href="/calendario"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "mt-2 min-h-[44px] rounded-xl font-semibold text-primary hover:bg-primary/10 hover:text-primary"
            )}
          >
            e mais {hidden}
          </Link>
        )}
      </Card>
    </section>
  );
}
