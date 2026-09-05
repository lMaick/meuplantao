import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedUserId, throwOnError } from "@/lib/dal";
export type Contact = { id: string; user_id: string; nome: string; telefone: string | null; tipo: string | null; created_at: string; updated_at: string };
export type ContactInput = Pick<Contact, "nome" | "telefone" | "tipo">;
export type ContactUpdate = Partial<ContactInput>;
export async function listContacts(): Promise<Contact[]> { const u=await getAuthenticatedUserId(); const {data,error}=await createClient().from("contacts").select("*").eq("user_id",u).order("nome"); throwOnError(error); return (data??[]) as Contact[]; }
export async function getContact(id:string):Promise<Contact|null>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("contacts").select("*").eq("id",id).eq("user_id",u).maybeSingle();throwOnError(error);return data as Contact|null;}
export async function createContact(input:ContactInput):Promise<Contact>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("contacts").insert({...input,user_id:u}).select("*").single();throwOnError(error);return data as Contact;}
export async function updateContact(id:string,input:ContactUpdate):Promise<Contact>{const u=await getAuthenticatedUserId();const {data,error}=await createClient().from("contacts").update(input).eq("id",id).eq("user_id",u).select("*").single();throwOnError(error);return data as Contact;}
export async function removeContact(id:string):Promise<void>{const u=await getAuthenticatedUserId();const {error}=await createClient().from("contacts").delete().eq("id",id).eq("user_id",u);throwOnError(error);}
