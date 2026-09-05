import { createClient } from "@/lib/supabase/client";
import { createJwtRecovery, SESSION_EXPIRED_MESSAGE } from "@/lib/auth/jwt-recovery";

let recoverSession: ReturnType<typeof createJwtRecovery> | undefined;

export async function getAuthenticatedUserId(): Promise<string> {
  const { data, error } = await createClient().auth.getUser();
  await throwOnError(error);
  if (!data.user) throw new Error("Usuário não autenticado.");
  return data.user.id;
}

export async function throwOnError(error: { message: string } | null): Promise<void> {
  if (!error) return;
  if (typeof window !== "undefined") {
    recoverSession ??= createJwtRecovery(
      () => createClient().auth.signOut({ scope: "local" }),
      window.location,
    );
    if (await recoverSession(error)) throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  throw error instanceof Error ? error : new Error(error.message, { cause: error });
}
