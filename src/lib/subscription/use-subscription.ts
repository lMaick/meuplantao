"use client";
/* eslint-disable react-hooks/set-state-in-effect -- initial data load is asynchronous */

import { useCallback, useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateTrial } from "./trial";
import type { TrialInfo } from "./types";

interface SubscriptionRow {
  status: string | null;
}

export interface SubscriptionState {
  trial: TrialInfo | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useSubscription(): SubscriptionState {
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Identificador único por instância do hook: evita colisão de canais
  // Realtime quando TrialBadge e TrialBadgeMobile montam simultaneamente
  // no AppShell (Supabase retorna a mesma instância de canal já assinado
  // e lança "cannot add 'postgres_changes' callbacks ... after 'subscribe()'").
  // useId() é puro (lint-safe) e estável por instância.
  const rawInstanceId = useId().replace(/:/g, "-");
  const channelName = userId ? `subscription-status:${userId}:${rawInstanceId}` : null;

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true);

    try {
      setError(null);
      const supabase = createClient();
      const { data, error: userError } = await supabase.auth.getUser();

      if (userError || !data.user) {
        setUserId(null);
        setTrial(calculateTrial(new Date().toISOString(), null));
        if (userError) setError(userError);
        return;
      }

      const { data: subscription, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", data.user.id)
        .maybeSingle() as { data: SubscriptionRow | null; error: Error | null };

      if (subscriptionError) throw subscriptionError;

      setUserId(data.user.id);
      setTrial(calculateTrial(data.user.created_at, subscription?.status));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Erro ao carregar dados de assinatura"));
      setTrial(calculateTrial(new Date().toISOString(), null));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSubscription();
  }, [fetchSubscription]);

  useEffect(() => {
    if (!userId || !channelName) return;

    const supabase = createClient();

    try {
      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "subscriptions",
            filter: `user_id=eq.${userId}`,
          },
          () => void fetchSubscription(),
        )
        .subscribe();

      return () => {
        try {
          void supabase.removeChannel(channel);
        } catch (cleanupError) {
          console.warn(
            "[useSubscription] Falha ao remover canal Realtime (degradação graciosa):",
            cleanupError,
          );
        }
      };
    } catch (realtimeError) {
      // Degradação graciosa: falha no Realtime nunca deve derrubar a
      // aplicação nem acionar o Global Error Boundary (React 19).
      console.warn(
        "[useSubscription] Realtime indisponível, seguindo sem assinatura (degradação graciosa):",
        realtimeError,
      );
      return;
    }
  }, [channelName, fetchSubscription, userId]);

  return {
    trial,
    isLoading,
    error,
    refresh: fetchSubscription,
  };
}
