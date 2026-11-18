import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { OfflineActions } from "./offline-actions";

export const metadata: Metadata = {
  title: "Sem conexão | MeuPlantão",
  description: "Verifique sua conexão com a internet para carregar seus plantões e recebimentos.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md border-border/80 bg-card p-6 text-center shadow-sm sm:p-8 animate-in fade-in duration-200 motion-reduce:animate-none">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <WifiOff className="size-7" aria-hidden="true" />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-primary">
          MeuPlantão
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          Você está sem conexão
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Não foi possível conectar ao servidor no momento. Verifique sua internet (Wi-Fi ou dados
          móveis) e tente novamente para consultar seus plantões e saldos atualizados.
        </p>
        <OfflineActions />
      </Card>
    </main>
  );
}
