import type { ReactNode } from "react";

export function AppState({ title, description, children }: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-4 rounded-xl border bg-background p-6 text-center shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-primary">MeuPlantao</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        {children}
      </section>
    </main>
  );
}
