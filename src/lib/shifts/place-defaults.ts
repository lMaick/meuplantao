export type PlaceDefaults = {
  id: string;
  valor_padrao: number | null;
  prazo_recebimento_dias: number | null;
  responsavel_contact_id: string | null;
};

export type ShiftForDefaults = {
  data: string;
  valor_previsto: number | null;
};

export type RealizedDefaults = {
  valor: number | null;
  dataPrevista: string | null;
  responsavelTipo: "local" | "contato";
  responsavelId: string;
  /** Verdadeiro quando há tudo que um plantão realizado exige. */
  completo: boolean;
};

export function dueDateFromTerm(shiftDateIso: string, prazoDias: number | null): string | null {
  if (prazoDias === null || !Number.isInteger(prazoDias) || prazoDias < 0) return null;
  // Meio-dia UTC: soma de dias de calendário, imune a fuso e horário de verão.
  const date = new Date(`${shiftDateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + prazoDias);
  return date.toISOString().slice(0, 10);
}

/**
 * Sugere os dados financeiros de um plantão realizado a partir do local.
 * Apenas sugere: quem cria a obrigação continua sendo save_shift_with_obligation.
 * O valor já informado no plantão, mesmo zero, tem prioridade sobre o padrão.
 */
export function resolveRealizedDefaults(shift: ShiftForDefaults, place: PlaceDefaults): RealizedDefaults {
  const valor = shift.valor_previsto ?? place.valor_padrao;
  const dataPrevista = dueDateFromTerm(shift.data, place.prazo_recebimento_dias);
  const responsavelTipo = place.responsavel_contact_id ? "contato" : "local";
  const responsavelId = place.responsavel_contact_id ?? place.id;

  return {
    valor,
    dataPrevista,
    responsavelTipo,
    responsavelId,
    completo: valor !== null && dataPrevista !== null,
  };
}
