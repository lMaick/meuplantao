import { listPlaces } from "@/lib/places";
import { listShifts, type Shift } from "@/lib/shifts";
import { isOverdue, listObligations } from "@/lib/obligations";

export type Alert = {
  id: string;
  kind: "atraso" | "proximo";
  title: string;
  description: string;
  shift: Shift;
  placeName: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function listAlerts(): Promise<Alert[]> {
  const [shifts, places, obligations] = await Promise.all([
    listShifts(),
    listPlaces(),
    listObligations(),
  ]);
  const obligationByShift = new Map(obligations.map((obligation) => [obligation.shift_id, obligation]));
  const placeNames = new Map(places.map((place) => [place.id, place.nome]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today.getTime() + 7 * DAY_MS);

  return shifts
    .flatMap((shift): Alert[] => {
      const obligation = obligationByShift.get(shift.id);
      const shiftDate = new Date(`${shift.data}T00:00:00`);
      if (!obligation) return [];
      const placeName = placeNames.get(shift.place_id) ?? "Local não encontrado";
      const remaining = Number(obligation.saldo ?? 0);
      if (shift.status === "realizado" && remaining > 0 && isOverdue(obligation.data_prevista)) {
        return [{ id: `atraso-${shift.id}`, kind: "atraso", title: "Recebimento em atraso", description: `${placeName} · saldo de R$ ${remaining.toFixed(2).replace(".", ",")} pendente`, shift, placeName }];
      }
      if (shift.status === "agendado" && shiftDate >= today && shiftDate <= nextWeek) {
        return [{ id: `proximo-${shift.id}`, kind: "proximo", title: "Próximo plantão", description: `${placeName} · ${shift.data.split("-").reverse().join("/")} às ${shift.hora_inicio.slice(0, 5)}`, shift, placeName }];
      }
      return [];
    })
    .sort((a, b) => a.shift.data.localeCompare(b.shift.data));
}
