import { listPayments } from "@/lib/payments";
import { listPlaces } from "@/lib/places";
import { listShifts } from "@/lib/shifts";
import HistoryView from "./history-view";

export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const [shifts, payments, places] = await Promise.all([
    listShifts(),
    listPayments(),
    listPlaces(),
  ]);

  return <HistoryView shifts={shifts} payments={payments} places={places} />;
}
