"use client";

import Link from "next/link";
import { AppState } from "@/components/app-state";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppState title="Não foi possível carregar a página" description="Tente novamente. Se o problema continuar, volte ao início.">
      <div className="flex flex-col gap-3">
        <button onClick={reset} className="min-h-11 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2">Tentar novamente</button>
        <Link href="/" className="rounded-lg px-4 py-3 text-sm font-medium underline underline-offset-4 focus-visible:outline-2">Voltar ao início</Link>
      </div>
    </AppState>
  );
}
