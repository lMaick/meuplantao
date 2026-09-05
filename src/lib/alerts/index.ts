import { listPayments } from "@/lib/payments";
import { listPlaces } from "@/lib/places";
import { listShifts, type Shift } from "@/lib/shifts";

export type Alert = {
  id: string;
  kind: "atraso" | "proximo";
  title: string;
  description: string;
  shift: Shift;
  placeName: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export async function listAlerts(): Promise<Alert[]> {
  const [shifts, payments, places] = await Promise.all([
    listShifts(),
    listPayments(),
    listPlaces(),
  ]);
  const paidByShift = new Map<string, number>();
  payments
    .filter((payment) => payment.status === "registrado")
    .forEach((payment) => paidByShift.set(payment.shift_id, (paidByShift.get(payment.shift_id) ?? 0) + Number(payment.valor)));
  const placeNames = new Map(places.map((place) => [place.id, place.nome]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today.getTime() + 7 * DAY_MS);

  return shifts
    .flatMap((shift): Alert[] => {
      const shiftDate = dateOnly(shift.data);
      const placeName = placeNames.get(shift.place_id) ?? "Local não encontrado";
      const remaining = Number(shift.valor_previsto) - (paidByShift.get(shift.id) ?? 0);
      if (shift.status === "realizado" && remaining > 0 && shiftDate < today) {
        return [{ id: `atraso-${shift.id}`, kind: "atraso", title: "Recebimento em atraso", description: `${placeName} · saldo de R$ ${remaining.toFixed(2).replace(".", ",")} pendente`, shift, placeName }];
      }
      if (shift.status === "agendado" && shiftDate >= today && shiftDate <= nextWeek) {
        return [{ id: `proximo-${shift.id}`, kind: "proximo", title: "Próximo plantão", description: `${placeName} · ${shift.data.split("-").reverse().join("/")} às ${shift.hora_inicio.slice(0, 5)}`, shift, placeName }];
      }
      return [];
    })
    .sort((a, b) => a.shift.data.localeCompare(b.shift.data));
}
