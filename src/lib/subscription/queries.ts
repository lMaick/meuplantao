import { createClient } from "@/lib/supabase/client";
import { throwOnError } from "@/lib/dal";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/jwt-recovery";

/**
 * DAL de assinatura (MAI-143).
 *
 * Centraliza TODA a leitura da tabela `subscriptions` usada pelo
 * `SubscriptionProvider` e pelo fallback do `useSubscription`.
 * Providers/hooks consomem apenas estas funções — nunca `.from("subscriptions")` inline.
 *
 * - Usa apenas anon key do browser (nunca chave administrativa no cliente).
 * - Filtra sempre por `user_id = auth.uid()` (via `auth.getUser()` + `.eq("user_id", id)`).
 * - RLS (`subscriptions_select_own`) permanece como proteção do banco.
 * - Erros JWT/sessão passam por `throwOnError` (recuperação + SESSION_EXPIRED_MESSAGE).
 */

export interface SubscriptionRow {
  status: string | null;
  current_period_end: string | null;
}

export interface MySubscription {
  userId: string;
  createdAt: string | null;
  subscription: SubscriptionRow | null;
}

export const SUBSCRIPTION_SELECT = "status, current_period_end" as const;
export const SUBSCRIPTION_TABLE = "subscriptions" as const;

/** Erro lançado quando não há sessão (sem usuário). Distinto de JWT expirado. */
export const UNAUTHENTICATED_MESSAGE = "Usuário não autenticado." as const;

/**
 * Retorna true para falhas de autenticação que invalidam o estado anterior:
 * sessão ausente (`UNAUTHENTICATED_MESSAGE`) ou JWT expirado/inválido
 * (`SESSION_EXPIRED_MESSAGE` via `throwOnError`).
 *
 * O provider/hook DEVE limpar `userId`, `createdAt` e qualquer `trial` Pro
 * anterior quando este helper retorna true — nunca preservar `prev` (MAI-143).
 */
export function isSubscriptionAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === UNAUTHENTICATED_MESSAGE || message === SESSION_EXPIRED_MESSAGE;
}

/** Retorna true apenas para JWT expirado/inválido (erro visível; pede re-login). */
export function isSessionExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === SESSION_EXPIRED_MESSAGE;
}

type SupabaseBrowserClient = ReturnType<typeof createClient>;

function resolveClient(client?: SupabaseBrowserClient): SupabaseBrowserClient {
  return client ?? createClient();
}

/**
 * Busca a sessão autenticada (userId + createdAt).
 * Lança `SESSION_EXPIRED_MESSAGE` quando o JWT é inválido/expirado
 * e "Usuário não autenticado." quando não há sessão.
 */
export async function getSubscriptionSession(
  client?: SupabaseBrowserClient,
): Promise<{ userId: string; createdAt: string | null }> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase.auth.getUser();
  await throwOnError(error);
  if (!data.user) throw new Error(UNAUTHENTICATED_MESSAGE);
  return { userId: data.user.id, createdAt: data.user.created_at ?? null };
}

/**
 * Lê a linha `subscriptions` do usuário autenticado.
 * Sempre filtra por `user_id` — isolamento entre usuários + RLS.
 */
export async function getMySubscriptionRow(
  userId: string,
  client?: SupabaseBrowserClient,
): Promise<SubscriptionRow | null> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from(SUBSCRIPTION_TABLE)
    .select(SUBSCRIPTION_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  await throwOnError(error);
  return (data as SubscriptionRow | null) ?? null;
}

/**
 * Contrato único de leitura do provider: sessão + linha de assinatura.
 * Preserva loading/erro/trial/Pro — o chamador deriva `TrialInfo` via `calculateTrial`.
 */
export async function fetchMySubscription(
  client?: SupabaseBrowserClient,
): Promise<MySubscription> {
  const supabase = resolveClient(client);
  const { userId, createdAt } = await getSubscriptionSession(supabase);
  const subscription = await getMySubscriptionRow(userId, supabase);
  return { userId, createdAt, subscription };
}

/** Nome determinístico do canal Realtime por usuário (+ sufixo por instância). */
export function subscriptionChannelName(userId: string, suffix = "provider"): string {
  return `subscription-status:${userId}:${suffix}`;
}

/** Filtro Realtime — garante que só eventos da própria linha disparam refresh. */
export function subscriptionRealtimeFilter(userId: string): string {
  return `user_id=eq.${userId}`;
}

export interface SubscriptionRealtimeParams {
  schema?: string;
  table?: string;
}

/**
 * Cria e assina o canal Realtime da assinatura do usuário.
 * Retorna o canal para que o chamador faça cleanup via `removeChannel`.
 * Falhas de transporte devem ser tratadas pelo chamador com degradação graciosa
 * (nunca derrubar o provider — ver `subscription-provider.tsx`).
 */
export function createSubscriptionChannel(
  supabase: SupabaseBrowserClient,
  userId: string,
  onChange: () => void,
  suffix = "provider",
  params: SubscriptionRealtimeParams = {},
) {
  const channel = supabase
    .channel(subscriptionChannelName(userId, suffix))
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: params.schema ?? "public",
        table: params.table ?? SUBSCRIPTION_TABLE,
        filter: subscriptionRealtimeFilter(userId),
      },
      () => onChange(),
    )
    .subscribe();
  return channel;
}

/**
 * Remove o canal Realtime com degradação graciosa (log interno, sem throw).
 */
export async function removeSubscriptionChannel(
  supabase: SupabaseBrowserClient,
  channel: unknown,
  logger: Pick<Console, "warn"> = console,
  tag = "[SubscriptionDAL]",
): Promise<void> {
  try {
    await supabase.removeChannel(channel as never);
  } catch (cleanupError) {
    logger.warn(`${tag} Falha ao remover canal Realtime:`, cleanupError);
  }
}
