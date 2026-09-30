"use client";
/* eslint-disable react-hooks/set-state-in-effect -- initial data load is asynchronous */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateTrial } from "./trial";
import {
  createSubscriptionChannel,
  fetchMySubscription,
  removeSubscriptionChannel,
} from "./queries";
import type { TrialInfo } from "./types";

export interface SubscriptionContextValue {
  trial: TrialInfo | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

/**
 * SubscriptionProvider (MAI-126, DAL MAI-143): instância única de busca + Realtime no AppShell.
 * TrialBadge (desktop), TrialBadgeMobile e SubscriptionCard consomem o mesmo
 * contexto e atualizam no mesmo milissegundo após sync/webhook, sem F5.
 *
 * Leitura via DAL (`fetchMySubscription` / `createSubscriptionChannel` em `./queries`).
 * Nenhuma query Supabase inline aqui — fronteira de camadas (AGENTS.md).
 */
export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const { userId: currentUserId, createdAt: userCreatedAt, subscription } =
        await fetchMySubscription();
      setUserId(currentUserId);
      setCreatedAt(userCreatedAt);
      setTrial(
        calculateTrial(
          userCreatedAt,
          subscription?.status,
          new Date(),
          subscription?.current_period_end,
        ),
      );
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error("Erro ao carregar dados de assinatura");
      const isUnauthenticated = normalized.message === "Usuário não autenticado.";
      // Sessão ausente: trial anônimo sem expor erro. Demais falhas (rede/RLS/sessão
      // expirada) preservam o erro para o paywall/sync degradarem com feedback.
      if (!isUnauthenticated) setError(normalized);
      setUserId((prev) => (isUnauthenticated ? null : prev));
      if (isUnauthenticated) setCreatedAt(null);
      setTrial((prev) => prev ?? calculateTrial(createdAt ?? new Date().toISOString(), null));
    } finally {
      setIsLoading(false);
    }
  }, [createdAt]);

  useEffect(() => {
    void fetchSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial única; refresh manual via contexto
  }, []);

  // Canal Realtime único por provider: qualquer UPDATE/INSERT na linha do
  // usuário recarrega o estado e propaga para todos os consumidores.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    try {
      const channel = createSubscriptionChannel(supabase, userId, () => void fetchSubscription());
      return () => {
        void removeSubscriptionChannel(supabase, channel, console, "[SubscriptionProvider]");
      };
    } catch (realtimeError) {
      console.warn("[SubscriptionProvider] Realtime indisponível (degradação graciosa):", realtimeError);
      return;
    }
  }, [fetchSubscription, userId]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({ trial, isLoading, error, refresh: fetchSubscription }),
    [trial, isLoading, error, fetchSubscription],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

/** Acesso ao estado global. Fora do provider retorna null (hook legado assume). */
export function useSubscriptionContext(): SubscriptionContextValue | null {
  return useContext(SubscriptionContext);
}
