import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedUserId, throwOnError } from "@/lib/dal";
export type ShiftStatus = "agendado" | "realizado" | "cancelado";
export type Shift = { id:string; user_id:string; place_id:string; data:string; hora_inicio:string; hora_fim:string; valor_previsto:number; status:ShiftStatus; created_at:string; updated_at:string };
export type ShiftInput = Omit<Pick<Shift,"place_id"|"data"|"hora_inicio"|"hora_fim"|"valor_previsto">, "valor_previsto"> & { valor_previsto: number | null; status?: ShiftStatus };
export type ShiftUpdate = Partial<ShiftInput>;
export async function listShifts():Promise<Shift[]>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").select("*").eq("user_id",u).order("data",{ascending:false});await throwOnError(error);return (data??[]) as Shift[];}
export async function getShift(id:string):Promise<Shift|null>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").select("*").eq("id",id).eq("user_id",u).maybeSingle();await throwOnError(error);return data as Shift|null;}
function normalize(input: ShiftInput | ShiftUpdate) { return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, key === "valor_previsto" && value === "" ? null : value])); }
export async function createShift(input:ShiftInput):Promise<Shift>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").insert({...normalize(input),user_id:u}).select("*").single();await throwOnError(error);return data as Shift;}
export async function updateShift(id:string,input:ShiftUpdate):Promise<Shift>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").update(normalize(input)).eq("id",id).eq("user_id",u).select("*").single();await throwOnError(error);return data as Shift;}
export async function removeShift(id:string):Promise<void>{const u=await getAuthenticatedUserId();const {error}=await createClient().from("shifts").delete().eq("id",id).eq("user_id",u);await throwOnError(error);}
