import { Bell } from "lucide-react";
import { AlertsList } from "@/components/alerts/alerts-list";

export default function AlertsPage() {
  return <main className="mx-auto w-full max-w-2xl flex-1 bg-zinc-50 px-4 py-8 sm:px-6"><div className="mb-8 flex items-start gap-3"><div className="rounded-xl bg-zinc-900 p-3 text-white"><Bell className="h-6 w-6" /></div><div><p className="text-sm font-medium text-zinc-500">MeuPlantão</p><h1 className="text-2xl font-bold tracking-tight text-zinc-950">Alertas</h1><p className="mt-1 text-sm text-zinc-600">Acompanhe atrasos e os próximos compromissos.</p></div></div><AlertsList /></main>;
}
