import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedUserId, throwOnError } from "@/lib/dal";

export type Obligation = { id: string; user_id: string; shift_id: string; valor_devido: number | null; data_prevista: string; responsavel_place_id: string | null; responsavel_contact_id: string | null; saldo: number | null; atrasada: boolean; created_at: string; updated_at: string };
export type ObligationInput = Pick<Obligation, "shift_id" | "valor_devido" | "data_prevista" | "responsavel_place_id" | "responsavel_contact_id">;
export type ObligationUpdate = Partial<Omit<ObligationInput, "shift_id">>;
export async function listObligations(): Promise<Obligation[]> { const u = await getAuthenticatedUserId(); const { data, error } = await createClient().from("obligations_with_balance").select("*").eq("user_id", u).order("data_prevista", { ascending: true }); await throwOnError(error); return (data ?? []) as Obligation[]; }
export async function getObligation(id: string): Promise<Obligation | null> { const u = await getAuthenticatedUserId(); const { data, error } = await createClient().from("obligations_with_balance").select("*").eq("id", id).eq("user_id", u).maybeSingle(); await throwOnError(error); return data as Obligation | null; }
export async function createObligation(input: ObligationInput): Promise<Obligation> { const u = await getAuthenticatedUserId(); const { data, error } = await createClient().from("obligations").insert({ ...input, user_id: u }).select("*").single(); await throwOnError(error); return data as Obligation; }
export async function updateObligation(id: string, input: ObligationUpdate): Promise<Obligation> { const u = await getAuthenticatedUserId(); const { data, error } = await createClient().from("obligations").update(input).eq("id", id).eq("user_id", u).select("*").single(); await throwOnError(error); return data as Obligation; }
export async function removeObligation(id: string): Promise<void> { const u = await getAuthenticatedUserId(); const { error } = await createClient().from("obligations").delete().eq("id", id).eq("user_id", u); await throwOnError(error); }
