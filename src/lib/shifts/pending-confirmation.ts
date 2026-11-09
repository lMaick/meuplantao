export type ConfirmableShift = {
  status: "agendado" | "realizado" | "cancelado";
  /** Data ISO (YYYY-MM-DD) do plantão. */
  data: string;
  hora_inicio?: string;
};

/**
 * Plantões ainda "agendado" cuja data já passou: o usuário precisa dizer se
 * aconteceram. Só quem passa por save_shift_with_obligation cria obrigação,
 * então plantão esquecido some do painel financeiro. O "hoje" (fuso da
 * aplicação, America/Bahia) vem do chamador.
 * Ordem: do mais antigo para o mais novo.
 */
export function listPendingConfirmations<T extends ConfirmableShift>(
  shifts: readonly T[],
  todayIso: string
): T[] {
  return shifts
    .filter((shift) => shift.status === "agendado" && shift.data < todayIso)
    .sort((a, b) =>
      `${a.data}${a.hora_inicio ?? ""}`.localeCompare(`${b.data}${b.hora_inicio ?? ""}`)
    );
}
