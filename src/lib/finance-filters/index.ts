export const ALL_PERIODS = "all";
export const ALL_PLACES = "all";

export type PeriodFilter = string;

export function currentMonthValue(today = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).format(today);
}

export function isMonthValue(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function normalizePeriod(value: string | null | undefined, fallbackToday = new Date()): PeriodFilter {
  if (value === ALL_PERIODS || value === "todos" || value === "") return ALL_PERIODS;
  if (value && isMonthValue(value)) return value;
  return currentMonthValue(fallbackToday);
}

export function normalizePlace(value: string | null | undefined): string {
  if (!value || value === ALL_PLACES || value === "todos") return ALL_PLACES;
  return value;
}

export function matchesPeriod(dateIso: string, period: PeriodFilter): boolean {
  if (period === ALL_PERIODS) return true;
  return dateIso.startsWith(period);
}

export function matchesPlace(placeId: string, placeFilter: string): boolean {
  const normalized = normalizePlace(placeFilter);
  if (normalized === ALL_PLACES) return true;
  return placeId === normalized;
}

export function matchesShift(shift: { data: string; place_id: string }, period: PeriodFilter, placeFilter: string): boolean {
  return matchesPeriod(shift.data, period) && matchesPlace(shift.place_id, placeFilter);
}

export function formatPeriodLabel(period: PeriodFilter): string {
  if (period === ALL_PERIODS) return "Todos os periodos";
  const [year, month] = period.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "America/Bahia" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return label.replace(".", "");
}

export function receivedLabel(period: PeriodFilter): string {
  if (period === ALL_PERIODS) return "Recebido (todos)";
  return `Recebido em ${formatPeriodLabel(period)}`;
}
