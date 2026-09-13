export const SAO_PAULO_TZ = "America/Sao_Paulo";
export const ALL_PLACES = "all";

const MS_PER_DAY = 86_400_000;

export function matchesPlace(placeId: string, placeFilter: string): boolean {
  if (!placeFilter || placeFilter === ALL_PLACES || placeFilter === "todos") return true;
  return placeId === placeFilter;
}

export function getSaoPauloDateIso(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SAO_PAULO_TZ }).format(date);
}

export function addDaysToIso(baseIso: string, days: number): string {
  const date = new Date(`${baseIso}T12:00:00-03:00`);
  date.setDate(date.getDate() + days);
  return getSaoPauloDateIso(date);
}

export function calculateDaysDiff(targetDateIso: string, baseDateIso: string): number {
  const targetMs = new Date(`${targetDateIso}T12:00:00-03:00`).getTime();
  const baseMs = new Date(`${baseDateIso}T12:00:00-03:00`).getTime();
  return Math.round((targetMs - baseMs) / MS_PER_DAY);
}

export type AlertShift = {
  id: string;
  status: "agendado" | "realizado" | "cancelado";
  place_id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
};

export type AlertObligation = {
  id: string;
  shift_id: string;
  valor_devido: number | null;
  saldo: number | null;
  data_prevista: string;
  responsavel_place_id: string | null;
  responsavel_contact_id: string | null;
};

export type AlertPlace = {
  id: string;
  nome: string;
};

export type AlertContact = {
  id: string;
  nome: string;
};

export type TopOverdueItem = {
  obligationId: string;
  shiftId: string;
  responsibleName: string;
  placeName: string;
  dataPrevista: string;
  balance: number;
  daysOverdue: number;
};

export type TopUpcomingItem = {
  obligationId: string;
  shiftId: string;
  responsibleName: string;
  placeName: string;
  dataPrevista: string;
  balance: number;
  daysUntilDue: number;
};

export type DashboardAlertsSummary = {
  overdueCount: number;
  overdueAmount: number;
  upcomingCount: number;
  upcomingAmount: number;
  topOverdue: TopOverdueItem | null;
  topUpcoming: TopUpcomingItem | null;
  hasAlerts: boolean;
};

export type ComputeAlertsParams = {
  shifts: AlertShift[];
  obligations: AlertObligation[];
  places?: AlertPlace[];
  contacts?: AlertContact[];
  placeId?: string;
  now?: Date | string;
  referenceDate?: Date | string;
};

export function computeDashboardAlerts(params: ComputeAlertsParams): DashboardAlertsSummary {
  const {
    shifts,
    obligations,
    places = [],
    contacts = [],
    placeId = ALL_PLACES,
    now = params.now ?? params.referenceDate ?? new Date(),
  } = params;

  const todayIso = typeof now === "string" && /^\d{4}-\d{2}-\d{2}$/.test(now)
    ? now
    : getSaoPauloDateIso(now instanceof Date ? now : new Date(now));

  const maxUpcomingIso = addDaysToIso(todayIso, 7);

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const placeNames = new Map(places.map((p) => [p.id, p.nome]));
  const contactNames = new Map(contacts.map((c) => [c.id, c.nome]));

  let overdueCount = 0;
  let overdueAmount = 0;
  let upcomingCount = 0;
  let upcomingAmount = 0;

  const overdueList: TopOverdueItem[] = [];
  const upcomingList: TopUpcomingItem[] = [];

  for (const obligation of obligations) {
    if (obligation.valor_devido === null || obligation.valor_devido <= 0) continue;

    const shift = shiftById.get(obligation.shift_id);
    // Plantões quitados (saldo = 0), cancelados ou não realizados nunca devem gerar alerta financeiro
    if (!shift || shift.status !== "realizado") continue;

    const balance = Math.max(0, Number(obligation.saldo ?? 0));
    if (balance <= 0) continue; // Quitado

    if (placeId !== ALL_PLACES && !matchesPlace(shift.place_id, placeId)) continue;

    const responsibleName = obligation.responsavel_contact_id
      ? (contactNames.get(obligation.responsavel_contact_id) ?? "Contato")
      : obligation.responsavel_place_id
        ? (placeNames.get(obligation.responsavel_place_id) ?? "Local")
        : (placeNames.get(shift.place_id) ?? "Local não informado");

    const placeName = placeNames.get(shift.place_id) ?? "Local não informado";
    const dataPrevista = obligation.data_prevista;

    // Atraso: data_prevista < hoje (o dia seguinte à data_prevista caracteriza atraso)
    if (dataPrevista < todayIso) {
      overdueCount++;
      overdueAmount += balance;
      const daysDiff = calculateDaysDiff(dataPrevista, todayIso);
      const daysOverdue = Math.max(1, Math.abs(daysDiff));
      overdueList.push({
        obligationId: obligation.id,
        shiftId: shift.id,
        responsibleName,
        placeName,
        dataPrevista,
        balance,
        daysOverdue,
      });
    } else if (dataPrevista >= todayIso && dataPrevista <= maxUpcomingIso) {
      // Vencendo nos próximos 7 dias
      upcomingCount++;
      upcomingAmount += balance;
      const daysUntilDue = Math.max(0, calculateDaysDiff(dataPrevista, todayIso));
      upcomingList.push({
        obligationId: obligation.id,
        shiftId: shift.id,
        responsibleName,
        placeName,
        dataPrevista,
        balance,
        daysUntilDue,
      });
    }
  }

  // Ordena atrasados pelo maior saldo devedor, desempatando pelo maior número de dias em atraso
  overdueList.sort((a, b) => b.balance - a.balance || b.daysOverdue - a.daysOverdue);

  // Ordena a vencer pela data de vencimento mais próxima, desempatando pelo maior valor
  upcomingList.sort((a, b) => a.daysUntilDue - b.daysUntilDue || b.balance - a.balance);

  const topOverdue = overdueList.length > 0 ? overdueList[0] : null;
  const topUpcoming = upcomingList.length > 0 ? upcomingList[0] : null;

  return {
    overdueCount,
    overdueAmount,
    upcomingCount,
    upcomingAmount,
    topOverdue,
    topUpcoming,
    hasAlerts: overdueCount > 0 || upcomingCount > 0,
  };
}
