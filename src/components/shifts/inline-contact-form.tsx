"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { createContact, type Contact } from "@/lib/contacts";

/**
 * Campos embutidos para criar um pagador (contato) sem sair do formulário de
 * plantão. Sem elemento form e sem atributo name: nada daqui entra no FormData do plantão,
 * e Enter salva só o pagador.
 */
export function InlineContactForm({
  onCreated,
  onCancel,
}: {
  onCreated: (contact: Contact) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    const trimmed = nome.trim();
    if (!trimmed) {
      setError("Informe o nome do pagador.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const contact = await createContact({ nome: trimmed, telefone: telefone.trim() || null, tipo: null });
      onCreated(contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o pagador. Tente novamente.");
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    } else if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-label="Novo pagador"
      aria-busy={busy}
      onKeyDown={onKeyDown}
      className="motion-success grid gap-3 rounded-xl border border-border/70 bg-background p-3.5 motion-reduce:animate-none"
    >
      <label htmlFor={`${uid}-nome`} className="grid gap-1.5 text-sm font-medium text-foreground">
        <span>Nome do pagador</span>
        <Input
          id={`${uid}-nome`}
          autoFocus
          required
          autoComplete="off"
          placeholder="Ex.: Maria (financeiro)"
          value={nome}
          disabled={busy}
          aria-invalid={error && !nome.trim() ? true : undefined}
          onChange={(event) => setNome(event.target.value)}
        />
      </label>
      <label htmlFor={`${uid}-tel`} className="grid gap-1.5 text-sm font-medium text-foreground">
        <span>Telefone (opcional)</span>
        <Input
          id={`${uid}-tel`}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={telefone}
          disabled={busy}
          onChange={(event) => setTelefone(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel} className="min-h-[44px] w-full sm:w-auto">
          Cancelar
        </Button>
        <Button type="button" disabled={busy} onClick={() => void submit()} className="min-h-[44px] w-full sm:w-auto font-semibold">
          {busy ? "Salvando pagador..." : "Salvar pagador"}
        </Button>
      </div>
    </div>
  );
}
