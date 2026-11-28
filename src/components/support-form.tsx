"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

type SubmitState = "idle" | "sending" | "sent" | "error";

export function SupportForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState("sending");
    setErrorMessage("");

    const form = new FormData(formElement);
    const response = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        subject: form.get("subject"),
        message: form.get("message"),
        website: form.get("website"),
      }),
    }).catch(() => null);

    if (!response) {
      setState("error");
      setErrorMessage("Não foi possível enviar agora. Tente novamente ou escreva para contato@meuplantao.pro.");
      return;
    }

    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (response.ok && result?.ok === true) {
      setState("sent");
      formElement.reset();
      return;
    }

    setState("error");
    const message = result?.error?.trim() || "Não foi possível confirmar o envio.";
    const fallback = "Se o problema continuar, escreva para contato@meuplantao.pro.";
    setErrorMessage(message.includes("contato@meuplantao.pro") ? message : `${message} ${fallback}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-muted/20 p-5 sm:p-6">
      <div className="space-y-1.5">
        <label htmlFor="support-name" className="text-sm font-medium">Seu nome</label>
        <input id="support-name" name="name" required maxLength={100} autoComplete="name" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="support-email" className="text-sm font-medium">Seu e-mail</label>
        <input id="support-email" name="email" type="email" required maxLength={254} autoComplete="email" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="support-subject" className="text-sm font-medium">Assunto</label>
        <input id="support-subject" name="subject" required maxLength={120} placeholder="Ex.: dúvida sobre um repasse" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="support-message" className="text-sm font-medium">Mensagem</label>
        <textarea id="support-message" name="message" required maxLength={5000} rows={5} placeholder="Descreva sua dúvida. Não inclua senhas ou dados bancários sensíveis." className="w-full rounded-md border border-input bg-background p-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
      </div>

      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="support-website">Deixe este campo vazio</label>
        <input id="support-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Button type="submit" disabled={state === "sending"} className="min-h-[44px] w-full sm:w-auto">
        {state === "sending" ? "Enviando…" : "Enviar mensagem"}
      </Button>

      {state === "sent" && (
        <p role="status" className="text-sm text-emerald-700">Mensagem enviada. Nossa equipe responderá pelo e-mail informado.</p>
      )}
      {state === "error" && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
    </form>
  );
}
