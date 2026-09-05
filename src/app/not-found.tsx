import Link from "next/link";
import { AppState } from "@/components/app-state";

export default function NotFound() {
  return (
    <AppState title="Página não encontrada" description="Este endereço não existe. Confira o link ou volte ao início.">
      <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2">Voltar ao início</Link>
    </AppState>
  );
}
