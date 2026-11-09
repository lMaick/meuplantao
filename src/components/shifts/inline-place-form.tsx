"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { createPlace, type Place } from "@/lib/places";

/**
 * Campos embutidos para criar um local sem sair do formulário de plantão.
 * Fica dentro do formulário do plantão, então NÃO usa elemento form, NÃO usa atributo name
 * (nada daqui entra no FormData do plantão) e Enter salva só o local.
 */
export function InlinePlaceForm({
  onCreated,
  onCancel,
}: {
  onCreated: (place: Place) => void;
  /** Sem `onCancel` (nenhum local ainda) os campos não podem ser fechados. */
  onCancel?: () => void;
}) {
  const uid = useId();
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [prazo, setPrazo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    const trimmed = nome.trim();
    if (!trimmed) {
      setError("Informe o nome do local.");
      return;
    }
    const rawValor = valor.trim().replace(",", ".");
    let valorPadrao: number | null = null;
    if (rawValor !== "") {
      valorPadrao = Number(rawValor);
      if (!Number.isFinite(valorPadrao) || valorPadrao < 0) {
        setError("O valor padrão deve ser zero ou maior.");
        return;
      }
    }
    const rawPrazo = prazo.trim();
    let prazoDias: number | null = null;
    if (rawPrazo !== "") {
      prazoDias = Number(rawPrazo);
      if (!Number.isInteger(prazoDias) || prazoDias < 0 || prazoDias > 365) {
        setError("O prazo deve ser um número inteiro de 0 a 365 dias.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const place = await createPlace({
        nome: trimmed,
        endereco: null,
        valor_padrao: valorPadrao,
        prazo_recebimento_dias: prazoDias,
      });
      onCreated(place);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o local. Tente novamente.");
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    } else if (event.key === "Escape" && onCancel && !busy) {
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-label="Novo local"
      aria-busy={busy}
      onKeyDown={onKeyDown}
      className="motion-success grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5 motion-reduce:animate-none"
    >
      <label htmlFor={`${uid}-nome`} className="grid gap-1.5 text-sm font-medium text-foreground">
        <span>Nome do local</span>
        <Input
          id={`${uid}-nome`}
          autoFocus
          required
          autoComplete="off"
          placeholder="Ex.: Hospital Municipal"
          value={nome}
          disabled={busy}
          aria-invalid={error && !nome.trim() ? true : undefined}
          onChange={(event) => setNome(event.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={`${uid}-valor`} className="grid gap-1.5 text-sm font-medium text-foreground">
          <span>Valor padrão (R$)</span>
          <Input
            id={`${uid}-valor`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Opcional"
            value={valor}
            disabled={busy}
            onChange={(event) => setValor(event.target.value)}
          />
        </label>
        <label htmlFor={`${uid}-prazo`} className="grid gap-1.5 text-sm font-medium text-foreground">
          <span>Prazo (dias)</span>
          <Input
            id={`${uid}-prazo`}
            type="number"
            inputMode="numeric"
            min="0"
            max="365"
            step="1"
            placeholder="Opcional"
            value={prazo}
            disabled={busy}
            onChange={(event) => setPrazo(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel} className="min-h-[44px] w-full sm:w-auto">
            Cancelar
          </Button>
        )}
        <Button type="button" disabled={busy} onClick={() => void submit()} className="min-h-[44px] w-full sm:w-auto font-semibold">
          {busy ? "Salvando local..." : "Salvar local"}
        </Button>
      </div>
    </div>
  );
}
