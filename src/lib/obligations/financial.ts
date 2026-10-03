export type FinancialStatus = "agendado" | "realizado" | "cancelado";
export type FinancialObligation = { valor_devido: number | null; saldo: number | null };

export function financialAmounts(status: FinancialStatus, obligation?: FinancialObligation | null) {
  if (status !== "realizado" || !obligation || obligation.valor_devido === null) return { expected: 0, received: 0, balance: 0 };
  const expected = Number(obligation.valor_devido); const balance = Number(obligation.saldo ?? 0);
  return { expected, received: expected - balance, balance };
}

export function isOverdue(dataPrevista: string, today = new Date()): boolean {
  const todayIso = bahiaTodayIso(today);
  return new Date(`${dataPrevista}T00:00:00-03:00`).getTime() < new Date(`${todayIso}T00:00:00-03:00`).getTime();
}

export const BAHIA_TIME_ZONE = "America/Bahia";
export const FUTURE_PAYMENT_MESSAGE = "Data de recebimento nao pode ser futura";

export function bahiaTodayIso(today = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BAHIA_TIME_ZONE }).format(today);
}

export function isPaymentDateInFuture(dataPagamento: string, today = new Date()): boolean {
  const todayIso = bahiaTodayIso(today);
  return dataPagamento > todayIso;
}

export function assertPaymentDateNotFuture(dataPagamento: string, today = new Date()): void {
  if (!dataPagamento) throw new Error("Informe a data do pagamento.");
  if (isPaymentDateInFuture(dataPagamento, today)) throw new Error(FUTURE_PAYMENT_MESSAGE);
}

export type SettledPayment = { valor: number | string; data_pagamento: string; status: string };

export function summarizeSettledPayments(
  valorDevido: number | null,
  payments: SettledPayment[],
  today = new Date(),
): { expected: number; received: number; balance: number } {
  if (valorDevido === null) return { expected: 0, received: 0, balance: 0 };
  const expected = Number(valorDevido);
  const todayIso = bahiaTodayIso(today);
  const received = payments
    .filter((p) => p.status === "registrado" && p.data_pagamento <= todayIso)
    .reduce((sum, p) => sum + Number(p.valor), 0);
  return { expected, received, balance: Math.max(0, expected - received) };
}
