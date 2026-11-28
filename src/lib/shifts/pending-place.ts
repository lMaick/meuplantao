type PendingPlace = { id: string; valor_padrao: number | null };

/** Inclui o local confirmado pelo DAL sem depender de um novo render do React. */
export function isAvailablePlace(id: string, places: readonly { id: string }[], pendingPlace?: PendingPlace | null) {
  return pendingPlace?.id === id || places.some((place) => place.id === id);
}

/** Completa somente campos vazios; valores e pagadores escolhidos são preservados. */
export function applyPendingPlace(data: FormData, place: PendingPlace) {
  data.set("place_id", place.id);
  if (!String(data.get("valor_previsto") ?? "").trim() && place.valor_padrao !== null) {
    data.set("valor_previsto", String(place.valor_padrao));
  }
  if (data.get("status") === "realizado" && !data.get("responsavel_tipo") && !data.get("responsavel_id")) {
    data.set("responsavel_tipo", "local");
    data.set("responsavel_id", place.id);
  }
}
