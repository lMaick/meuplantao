"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DELETE_ACCOUNT_CONFIRMATION, isDeleteConfirmation } from "@/lib/account/delete-account";
import { createClient } from "@/lib/supabase/client";
import { useSubscription } from "@/lib/subscription";
import { useIsTwa } from "@/lib/twa/use-is-twa";
import { cn } from "cn";

type Session = { status: "loading" } | { status: "anonymous" } | { status: "signed-in"; email: string };
type DeleteState = "idle" | "deleting" | "done" | "error";

const CARD = "rounded-xl border bg-muted/20 p-5 sm:p-6";
const TEXT_LINK = "font-medium text-foreground underline underline-offset-4";

export function DeleteAccountCard() {
  const isTwa = useIsTwa();
  const { trial, refresh } = useSubscription();
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [confirmation, setConfirmation] = useState("");
  const [state, setState] = useState<DeleteState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.user ? { status: "signed-in", email: data.user.email ?? "" } : { status: "anonymous" });
        // Quem acabou de entrar ainda tem o plano de visitante em memória; sem
        // atualizar, o aviso de Pro ativo não apareceria.
        if (data.user) void refresh();
      })
      .catch(() => {
        if (active) setSession({ status: "anonymous" });
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isDeleteConfirmation(confirmation) || state === "deleting") return;
    setState("deleting");
    setErrorMessage("");

    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmacao: confirmation }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null | undefined;

    if (response?.ok && result?.ok === true) {
      // A sessão já não existe no servidor; limpa só o que ficou neste aparelho.
      await createClient().auth.signOut({ scope: "local" }).catch(() => undefined);
      setState("done");
      return;
    }
    setState("error");
    setErrorMessage(
      result?.error ?? "Não foi possível confirmar a exclusão. Verifique sua internet e tente novamente.",
    );
  }

  if (state === "done") {
    return (
      <div role="status" className={CARD}>
        <p className="font-semibold text-foreground">Sua conta foi excluída.</p>
        <p className="mt-1 text-muted-foreground">
          Seus dados foram apagados e você já saiu do MeuPlantão. Obrigado por ter usado o aplicativo.
        </p>
      </div>
    );
  }

  if (session.status === "loading") {
    return (
      <div aria-label="Carregando sua conta" className={cn(CARD, "space-y-3")}>
        <div className="h-5 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-11 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-11 w-44 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
    );
  }

  if (session.status === "anonymous") {
    return (
      <div className={cn(CARD, "space-y-4")}>
        <p>Entre na sua conta para excluí-la agora mesmo.</p>
        <Link href="/login?next=/excluir-conta" className={cn(buttonVariants(), "min-h-[44px]")}>
          Entrar para excluir
        </Link>
        <p className="text-muted-foreground">
          Não consegue entrar? Peça a exclusão pela página de{" "}
          <Link href="/suporte" className={TEXT_LINK}>
            Suporte
          </Link>{" "}
          ou pelo e-mail{" "}
          <a
            href="mailto:contato@meuplantao.pro?subject=Excluir%20minha%20conta%20do%20MeuPlant%C3%A3o"
            className={TEXT_LINK}
          >
            contato@meuplantao.pro
          </a>
          , usando o e-mail da conta.
        </p>
      </div>
    );
  }

  const activeUntil = trial?.isActive ? (trial.proEndsAt ?? trial.currentPeriodEnd) : null;
  const canDelete = isDeleteConfirmation(confirmation) && state !== "deleting";

  return (
    <form onSubmit={handleSubmit} className={cn(CARD, "space-y-4")}>
      <p>
        Conta: <strong className="break-all text-foreground">{session.email}</strong>
      </p>

      {trial?.isActive && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-300">
          <p className="font-semibold">
            {isTwa ? "Seu acesso completo" : "Seu MeuPlantão Pro"} ainda está ativo
            {activeUntil
              ? ` até ${new Date(activeUntil).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}`
              : ""}
            .
          </p>
          <p>
            Ao excluir, você perde os dias restantes.{" "}
            {isTwa
              ? "Se tiver dúvidas, fale com o suporte antes de excluir."
              : "Não há reembolso automático: se quiser pedir, fale com o suporte antes de excluir."}
          </p>
        </div>
      )}

      <p>
        Quer guardar seus registros? Baixe a planilha (CSV) em{" "}
        <Link href="/historico" className={TEXT_LINK}>
          Histórico
        </Link>{" "}
        e em{" "}
        <Link href="/pagamentos" className={TEXT_LINK}>
          Pagamentos
        </Link>{" "}
        antes de continuar.
      </p>

      <div className="space-y-1.5">
        <label htmlFor="delete-confirmation" className="font-medium text-foreground">
          Para confirmar, digite {DELETE_ACCOUNT_CONFIRMATION}
        </label>
        <input
          id="delete-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={state === "deleting"}
          aria-describedby="delete-warning"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p id="delete-warning" className="text-muted-foreground">
          A exclusão é imediata e não pode ser desfeita.
        </p>
      </div>

      {state === "error" && (
        <p role="alert" className="font-medium text-destructive">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="destructive" disabled={!canDelete} className="min-h-[44px]">
          {state === "deleting" ? "Excluindo…" : "Excluir minha conta"}
        </Button>
        <Link href="/perfil" className={cn(buttonVariants({ variant: "outline" }), "min-h-[44px]")}>
          Voltar sem excluir
        </Link>
      </div>
    </form>
  );
}
