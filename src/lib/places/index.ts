import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedUserId, throwOnError } from "@/lib/dal";

export type Place = { id: string; user_id: string; nome: string; endereco: string | null; created_at: string; updated_at: string };
export type PlaceInput = Pick<Place, "nome" | "endereco">;
export type PlaceUpdate = Partial<PlaceInput>;

export async function listPlaces(): Promise<Place[]> { const userId = await getAuthenticatedUserId(); const { data, error } = await createClient().from("places").select("*").eq("user_id", userId).order("nome"); await throwOnError(error); return (data ?? []) as Place[]; }
export async function getPlace(id: string): Promise<Place | null> { const userId = await getAuthenticatedUserId(); const { data, error } = await createClient().from("places").select("*").eq("id", id).eq("user_id", userId).maybeSingle(); await throwOnError(error); return data as Place | null; }
export async function createPlace(input: PlaceInput): Promise<Place> { const userId = await getAuthenticatedUserId(); const { data, error } = await createClient().from("places").insert({ ...input, user_id: userId }).select("*").single(); await throwOnError(error); return data as Place; }
export async function updatePlace(id: string, input: PlaceUpdate): Promise<Place> { const userId = await getAuthenticatedUserId(); const { data, error } = await createClient().from("places").update(input).eq("id", id).eq("user_id", userId).select("*").single(); await throwOnError(error); return data as Place; }
export async function removePlace(id: string): Promise<void> { const userId = await getAuthenticatedUserId(); const { error } = await createClient().from("places").delete().eq("id", id).eq("user_id", userId); await throwOnError(error); }
