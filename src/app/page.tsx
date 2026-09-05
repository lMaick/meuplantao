import { ShiftCalendar } from "@/components/shifts/shift-calendar";
import { listPlaces } from "@/lib/places";
import { listShifts } from "@/lib/shifts";

export default async function Home() {
  const [shifts, places] = await Promise.all([listShifts(), listPlaces()]);
  return <ShiftCalendar initialShifts={shifts} places={places} />;
}
