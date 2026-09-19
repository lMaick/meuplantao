"use client";
/* eslint-disable react-hooks/set-state-in-effect -- initial data load is asynchronous */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateTrial } from "./trial";
import type { TrialInfo } from "./types";

interface SubscriptionRow {
  status: string | null;
  current_period_end: string | null;
}

export interface SubscriptionContextValue {
  trial: TrialInfo | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

/**
 * SubscriptionProvider (MAI-126): instância única de busca + Realtime no AppShell.
 * TrialBadge (desktop), TrialBadgeMobile e SubscriptionCard consomem o mesmo
 * contexto e atualizam no mesmo milissegundo após sync/webhook, sem F5.
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
      const supabase = createClient();
      const { data, error: userError } = await supabase.auth.getUser();

      if (userError || !data.user) {
        setUserId(null);
        setCreatedAt(null);
        setTrial(calculateTrial(new Date().toISOString(), null));
        if (userError) setError(userError);
        return;
      }

      const { data: subscription, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", data.user.id)
        .maybeSingle() as { data: SubscriptionRow | null; error: Error | null };

      if (subscriptionError) throw subscriptionError;

      setUserId(data.user.id);
      setCreatedAt(data.user.created_at ?? null);
      setTrial(calculateTrial(data.user.created_at, subscription?.status, new Date(), subscription?.current_period_end));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Erro ao carregar dados de assinatura"));
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
      const channel = supabase
        .channel(`subscription-status:${userId}:provider`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
          () => void fetchSubscription(),
        )
        .subscribe();
      return () => {
        try {
          void supabase.removeChannel(channel);
        } catch (cleanupError) {
          console.warn("[SubscriptionProvider] Falha ao remover canal Realtime:", cleanupError);
        }
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
