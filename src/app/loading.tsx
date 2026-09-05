import { AppState } from "@/components/app-state";

export default function Loading() {
  return (
    <AppState title="Carregando" description="Aguarde enquanto preparamos a página.">
      <p role="status" className="text-sm text-muted-foreground">Carregando MeuPlantao…</p>
    </AppState>
  );
}
