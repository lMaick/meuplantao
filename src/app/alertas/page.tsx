import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { AlertsList } from "@/components/alerts/alerts-list";

export const metadata: Metadata = {
  title: "Alertas | MeuPlantão",
  description: "Acompanhe repasses em atraso e seus próximos compromissos.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AlertsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <header className="mb-8 flex items-start gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Bell className="size-6" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">MeuPlantão</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Alertas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acompanhe repasses em atraso e seus próximos compromissos.</p>
        </div>
      </header>
      <AlertsList />
    </main>
  );
}
