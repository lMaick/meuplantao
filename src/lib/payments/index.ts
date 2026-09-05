import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedUserId, throwOnError } from "@/lib/dal";
export type PaymentStatus = "registrado" | "cancelado";
export type Payment = { id:string; user_id:string; shift_id:string; valor:number; data_pagamento:string; status:PaymentStatus; created_at:string; updated_at:string };
export type PaymentInput = Pick<Payment,"shift_id"|"valor"|"data_pagamento"> & { status?: PaymentStatus };
export type PaymentUpdate = Partial<PaymentInput>;
export async function listPayments():Promise<Payment[]>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("payments").select("*").eq("user_id",u).order("data_pagamento",{ascending:false});await throwOnError(error);return (data??[]) as Payment[];}
export async function getPayment(id:string):Promise<Payment|null>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("payments").select("*").eq("id",id).eq("user_id",u).maybeSingle();await throwOnError(error);return data as Payment|null;}
export async function createPayment(input:PaymentInput):Promise<Payment>{await getAuthenticatedUserId();const {data,error}=await createClient().rpc("register_payment",{p_shift_id:input.shift_id,p_valor:input.valor,p_data_pagamento:input.data_pagamento});await throwOnError(error);return data as Payment;}
export async function updatePayment(id:string,input:PaymentUpdate):Promise<Payment>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("payments").update(input).eq("id",id).eq("user_id",u).select("*").single();await throwOnError(error);return data as Payment;}
export async function removePayment(id:string):Promise<void>{const u=await getAuthenticatedUserId();const {error}=await createClient().from("payments").delete().eq("id",id).eq("user_id",u);await throwOnError(error);}
