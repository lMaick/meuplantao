import { listPayments } from "@/lib/payments";
import { listPlaces } from "@/lib/places";
import { listShifts } from "@/lib/shifts";
import { listObligations } from "@/lib/obligations";
import HistoryView from "./history-view";

export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const [shifts, payments, places, obligations] = await Promise.all([
    listShifts(),
    listPayments(),
    listPlaces(),
    listObligations(),
  ]);

  return <HistoryView shifts={shifts} payments={payments} places={places} obligations={obligations} />;
}
