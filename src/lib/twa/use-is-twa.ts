"use client";

import { useSyncExternalStore } from "react";
import {
  isAndroidTwaReferrer,
  isTwaContext,
  TWA_COOKIE_MAX_AGE,
  TWA_COOKIE_NAME,
  TWA_QUERY_VALUE,
  resolveTwaOriginParam,
} from "./index";

const TWA_STATE_CHANGE_EVENT = "meuplantao:twa-change";

function readClientIsTwa(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const originParam = resolveTwaOriginParam(searchParams);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  if (originParam === "web") {
    document.cookie = `${TWA_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax${secure}`;
    delete document.documentElement.dataset.twa;
    return false;
  }

  const detected =
    document.documentElement.dataset.twa === "true" ||
    isTwaContext({
      searchParams,
      cookieHeader: document.cookie,
      referrer: document.referrer,
    });

  if (detected) {
    if (document.documentElement.dataset.twa !== "true") {
      document.documentElement.dataset.twa = "true";
    }
    if (originParam === "twa" || isAndroidTwaReferrer(document.referrer)) {
      document.cookie = `${TWA_COOKIE_NAME}=${TWA_QUERY_VALUE}; path=/; max-age=${TWA_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    }
  }

  return detected;
}

function subscribeTwaState(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", callback);
  window.addEventListener(TWA_STATE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(TWA_STATE_CHANGE_EVENT, callback);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Retorna `true` quando a aplicação está rodando dentro da TWA Android
 * (`?origem=twa`, cookie `mp_origem=twa` ou referrer `android-app://`).
 * Fora da TWA retorna `false` sem exigir boundary de Suspense no build estático.
 */
export function useIsTwa(): boolean {
  return useSyncExternalStore(subscribeTwaState, readClientIsTwa, getServerSnapshot);
}
