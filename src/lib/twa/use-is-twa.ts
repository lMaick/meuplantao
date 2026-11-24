"use client";

import { useSyncExternalStore } from "react";
import { hasTwaSessionMark } from "./index";

function readClientIsTwa(): boolean {
  return document.documentElement.dataset.twa === "true" || hasTwaSessionMark();
}

function subscribeTwaState(): () => void {
  // O React pode limpar atributos do <html> ao se recuperar de um erro de
  // hidratação; a marca da aba devolve o `data-twa` usado pelo CSS.
  if (hasTwaSessionMark()) document.documentElement.dataset.twa = "true";
  return () => {};
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` quando a aplicação roda dentro da TWA Android. A detecção é feita uma
 * vez por carga pelo script de `buildTwaBootstrapScript` no `<head>`.
 */
export function useIsTwa(): boolean {
  return useSyncExternalStore(subscribeTwaState, readClientIsTwa, getServerSnapshot);
}
