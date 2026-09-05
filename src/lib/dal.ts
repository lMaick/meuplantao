import { createClient } from "@/lib/supabase/client";

export async function getAuthenticatedUserId(): Promise<string> {
  const { data, error } = await createClient().auth.getUser();
  if (error || !data.user) throw new Error("Usuário não autenticado.");
  return data.user.id;
}

export function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}
