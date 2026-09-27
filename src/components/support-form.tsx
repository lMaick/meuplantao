"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL = "suporte@meuplantao.app";

export function SupportForm() {
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject") || "Suporte MeuPlantão");
    const message = String(form.get("message") || "");

    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(message)}`;

    window.location.href = mailtoUrl;
    setSent(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-muted/20 p-5 sm:p-6">
      <div className="space-y-1.5">
        <label htmlFor="support-subject" className="text-sm font-medium">
          Assunto
        </label>
        <input
          id="support-subject"
          name="subject"
          required
          placeholder="Ex: Dúvida sobre repasse ou sugestão de melhoria"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="support-message" className="text-sm font-medium">
          Mensagem
        </label>
        <textarea
          id="support-message"
          name="message"
          required
          rows={5}
          placeholder="Descreva o que aconteceu ou sua dúvida em detalhes. Não inclua senhas ou dados bancários sensíveis."
          className="w-full rounded-md border border-input bg-background p-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <Button type="submit" className="min-h-[44px] w-full sm:w-auto">
        Abrir no meu aplicativo de e-mail
      </Button>

      {sent && (
        <p role="status" className="text-xs text-muted-foreground">
          Seu aplicativo padrão de e-mail deve abrir com a mensagem preenchida para envio a{" "}
          <span className="font-mono text-foreground">{SUPPORT_EMAIL}</span>.
        </p>
      )}
    </form>
  );
}
