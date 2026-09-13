import { Suspense } from "react";
import { listContacts } from "@/lib/contacts";
import { listPlaces } from "@/lib/places";
import { listShifts } from "@/lib/shifts";
import { listObligations } from "@/lib/obligations";
import { HistorySkeleton } from "@/components/ui/skeletons";
import HistoryView from "./history-view";

export const dynamic = "force-dynamic";

async function HistoryContent() {
  const [shifts, places, obligations, contacts] = await Promise.all([
    listShifts(),
    listPlaces(),
    listObligations(),
    listContacts(),
  ]);

  return (
    <HistoryView
      shifts={shifts}
      places={places}
      obligations={obligations}
      contacts={contacts}
    />
  );
}

export default function HistoricoPage() {
  return (
    <Suspense fallback={<HistorySkeleton />}>
      <HistoryContent />
    </Suspense>
  );
}

