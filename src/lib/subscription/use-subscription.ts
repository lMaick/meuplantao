"use client";
/* eslint-disable react-hooks/set-state-in-effect -- initial data load is asynchronous */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calculateTrial } from "./trial";
import type { TrialInfo } from "./types";

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

  const fetchSubscription = useCallback(async () => {
    try {
      setError(null);
      const supabase = createClient();
      const { data, error: userError } = await supabase.auth.getUser();

      if (userError) {
        // Fallback for unauthenticated/guest state
        setTrial(calculateTrial(new Date().toISOString(), null));
        return;
      }

      if (data.user) {
        const createdAt = data.user.created_at;
        const subStatus =
          (data.user.user_metadata?.subscription_status as string | undefined) ??
          (data.user.app_metadata?.subscription_status as string | undefined) ??
          null;

        setTrial(calculateTrial(createdAt, subStatus));
      } else {
        setTrial(calculateTrial(new Date().toISOString(), null));
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Erro ao carregar dados de assinatura"));
      // Default graceful trial fallback
      setTrial(calculateTrial(new Date().toISOString(), null));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  return {
    trial,
    isLoading,
    error,
    refresh: fetchSubscription,
  };
}
