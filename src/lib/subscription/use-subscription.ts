"use client";
/* eslint-disable react-hooks/set-state-in-effect -- initial data load is asynchronous */

import { useCallback, useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateTrial } from "./trial";
import type { TrialInfo } from "./types";
import { useSubscriptionContext } from "./subscription-provider";
import {
  createSubscriptionChannel,
  fetchMySubscription,
  removeSubscriptionChannel,
} from "./queries";

export interface SubscriptionState {
  trial: TrialInfo | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook de assinatura (MAI-126, DAL MAI-143): quando montado dentro do SubscriptionProvider
 * (AppShell), retorna o estado global reativo compartilhado — sidebar, header
 * e card atualizam no mesmo milissegundo. Fora do provider, mantém busca
 * própria + Realtime dedicado (compatibilidade com páginas isoladas/testes).
 *
 * Leitura via DAL (`./queries`) — nenhuma query Supabase inline (AGENTS.md).
 */
export function useSubscription(): SubscriptionState {
  const shared = useSubscriptionContext();
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Identificador único por instância do hook: evita colisão de canais
  // Realtime quando TrialBadge e TrialBadgeMobile montam simultaneamente
  // fora do provider (Supabase retorna a mesma instância de canal já assinado
  // e lança "cannot add 'postgres_changes' callbacks ... after 'subscribe()'").
  // useId() é puro (lint-safe) e estável por instância.
  const rawInstanceId = useId().replace(/:/g, "-");
  const hasShared = shared !== null;

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true);

    try {
      setError(null);
      const { userId: currentUserId, createdAt, subscription } = await fetchMySubscription();
      setUserId(currentUserId);
      setTrial(
        calculateTrial(createdAt, subscription?.status, new Date(), subscription?.current_period_end),
      );
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error("Erro ao carregar dados de assinatura");
      if (normalized.message !== "Usuário não autenticado.") setError(normalized);
      else setUserId(null);
      setTrial(calculateTrial(new Date().toISOString(), null));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasShared) return;
    void fetchSubscription();
  }, [fetchSubscription, hasShared]);

  useEffect(() => {
    if (hasShared || !userId) return;

    const supabase = createClient();

    try {
      const channel = createSubscriptionChannel(
        supabase,
        userId,
        () => void fetchSubscription(),
        rawInstanceId,
      );

      return () => {
        void removeSubscriptionChannel(supabase, channel, console, "[useSubscription]");
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
  }, [rawInstanceId, fetchSubscription, userId, hasShared]);

  if (shared) return shared;

  return {
    trial,
    isLoading,
    error,
    refresh: fetchSubscription,
  };
}
