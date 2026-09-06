import { listPlaces } from "@/lib/places";
import { listShifts } from "@/lib/shifts";
import { listObligations } from "@/lib/obligations";
import HistoryView from "./history-view";

export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const [shifts, places, obligations] = await Promise.all([
    listShifts(),
    listPlaces(),
    listObligations(),
  ]);

  return <HistoryView shifts={shifts} places={places} obligations={obligations} />;
}
