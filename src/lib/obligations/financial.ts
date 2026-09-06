export type FinancialStatus = "agendado" | "realizado" | "cancelado";
export type FinancialObligation = { valor_devido: number | null; saldo: number | null };

export function financialAmounts(status: FinancialStatus, obligation?: FinancialObligation | null) {
  if (status !== "realizado" || !obligation || obligation.valor_devido === null) return { expected: 0, received: 0, balance: 0 };
  const expected = Number(obligation.valor_devido); const balance = Number(obligation.saldo ?? 0);
  return { expected, received: expected - balance, balance };
}

export function isOverdue(dataPrevista: string, today = new Date()): boolean {
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(today);
  return new Date(`${dataPrevista}T00:00:00-03:00`).getTime() < new Date(`${todayIso}T00:00:00-03:00`).getTime();
}
