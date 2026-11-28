import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isWellFormedUnsubscribeToken } from "@/lib/notifications/cron-auth";

export const metadata: Metadata = {
  title: "Descadastrar avisos | MeuPlantão",
  description: "Pare de receber os avisos por e-mail do MeuPlantão.",
  robots: { index: false, follow: false, nocache: true },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <section className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-card-foreground shadow-xs sm:p-8">
        <p className="text-sm font-semibold text-primary">MeuPlantão</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <div className="mt-4 space-y-5 text-sm leading-6 text-muted-foreground">{children}</div>
      </section>
    </main>
  );
}

export default async function UnsubscribePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : null;
  const token = typeof params.token === "string" ? params.token : null;

  if (status === "ok") {
    return (
      <Shell title="Pronto, avisos desligados">
        <p role="status">Você não vai mais receber os avisos por e-mail do MeuPlantão.</p>
        <p>Mudou de ideia? Ligue &quot;Avisos por e-mail&quot; em Configurações, dentro do app.</p>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell title="Não deu certo">
        <p role="alert">Tivemos um problema ao desligar os avisos. Tente de novo daqui a pouco pelo link do e-mail ou desligue em Configurações, dentro do app.</p>
      </Shell>
    );
  }

  if (!isWellFormedUnsubscribeToken(token)) {
    return (
      <Shell title="Link inválido">
        <p>Esse link de descadastro não funciona. Você pode desligar os avisos a qualquer momento em Configurações, dentro do app.</p>
      </Shell>
    );
  }

  return (
    <Shell title="Parar de receber avisos por e-mail?">
      <p>Você deixa de receber os avisos de atraso e o resumo semanal.</p>
      <form method="POST" action="/api/email/unsubscribe">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="from_page" value="1" />
        <button
          type="submit"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Sim, desligar os avisos
        </button>
      </form>
    </Shell>
  );
}
