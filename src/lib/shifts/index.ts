import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedUserId, throwOnError } from "@/lib/dal";
export type ShiftStatus = "agendado" | "realizado" | "cancelado";
export type Shift = { id:string; user_id:string; place_id:string; data:string; hora_inicio:string; hora_fim:string; valor_previsto:number; status:ShiftStatus; created_at:string; updated_at:string };
export type ShiftInput = Pick<Shift,"place_id"|"data"|"hora_inicio"|"hora_fim"|"valor_previsto"> & { status?: ShiftStatus };
export type ShiftUpdate = Partial<ShiftInput>;
async function paidAmount(id:string,userId:string):Promise<number>{const {data,error}=await createClient().from("payments").select("valor").eq("shift_id",id).eq("user_id",userId).eq("status","registrado");throwOnError(error);return (data??[]).reduce((sum,row)=>sum+Number(row.valor),0);}
export async function listShifts():Promise<Shift[]>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").select("*").eq("user_id",u).order("data",{ascending:false});throwOnError(error);return (data??[]) as Shift[];}
export async function getShift(id:string):Promise<Shift|null>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").select("*").eq("id",id).eq("user_id",u).maybeSingle();throwOnError(error);return data as Shift|null;}
export async function createShift(input:ShiftInput):Promise<Shift>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("shifts").insert({...input,user_id:u}).select("*").single();throwOnError(error);return data as Shift;}
export async function updateShift(id:string,input:ShiftUpdate):Promise<Shift>{const u=await getAuthenticatedUserId();if(input.valor_previsto!==undefined&&input.valor_previsto<await paidAmount(id,u))throw new Error("O valor do plantão não pode ficar abaixo dos pagamentos registrados.");const {data,error}=await createClient().from("shifts").update(input).eq("id",id).eq("user_id",u).select("*").single();throwOnError(error);return data as Shift;}
export async function removeShift(id:string):Promise<void>{const u=await getAuthenticatedUserId();if(await paidAmount(id,u)>0)throw new Error("Não é possível remover um plantão com pagamentos registrados.");const {error}=await createClient().from("shifts").delete().eq("id",id).eq("user_id",u);throwOnError(error);}
