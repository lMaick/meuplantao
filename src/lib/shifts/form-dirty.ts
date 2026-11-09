/**
 * Lógica pura (sem React, sem Supabase) para saber se o formulário de plantão
 * tem alterações que seriam perdidas ao fechar.
 */

export type ShiftFormSnapshot = {
  placeId: string;
  data: string;
  horaInicio: string;
  horaFim: string;
  valor: string;
  status: string;
  responsibleType: string;
  responsibleId: string;
  dueDate: string;
  extraDates: readonly string[];
};

function sameDates(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export function isShiftFormDirty(
  initial: ShiftFormSnapshot,
  current: ShiftFormSnapshot,
  options: { hasBulkRetry?: boolean; hasOpenSubform?: boolean } = {}
): boolean {
  // Lote parcialmente salvo e subformulários abertos sempre contam como alteração.
  if (options.hasBulkRetry || options.hasOpenSubform) return true;
  return (
    initial.placeId !== current.placeId ||
    initial.data !== current.data ||
    initial.horaInicio !== current.horaInicio ||
    initial.horaFim !== current.horaFim ||
    initial.valor.trim() !== current.valor.trim() ||
    initial.status !== current.status ||
    initial.responsibleType !== current.responsibleType ||
    initial.responsibleId !== current.responsibleId ||
    initial.dueDate !== current.dueDate ||
    !sameDates(initial.extraDates, current.extraDates)
  );
}
