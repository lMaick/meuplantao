import { listContacts } from "@/lib/contacts";
import { listPlaces } from "@/lib/places";
import { listShifts } from "@/lib/shifts";
import { listObligations } from "@/lib/obligations";
import HistoryView from "./history-view";

export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const [shifts, places, obligations, contacts] = await Promise.all([
    listShifts(),
    listPlaces(),
    listObligations(),
    listContacts(),
  ]);

  return <HistoryView shifts={shifts} places={places} obligations={obligations} contacts={contacts} />;
}
