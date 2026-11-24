import type { SupabaseClient } from "@supabase/supabase-js";

/** Palavra que a pessoa digita para confirmar a exclusão definitiva. */
export const DELETE_ACCOUNT_CONFIRMATION = "EXCLUIR";

export function isDeleteConfirmation(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === DELETE_ACCOUNT_CONFIRMATION;
}

/**
 * Apaga a conta e todos os dados do titular numa única transação
 * (RPC `delete_account`, só service_role). `userId` vem sempre da sessão
 * validada no servidor, nunca do corpo da requisição.
 */
export async function deleteAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
): Promise<{ deleted: boolean }> {
  const { data, error } = await admin.rpc("delete_account", { p_user_id: userId });
  if (error) throw error;
  return { deleted: (data as { deleted?: boolean } | null)?.deleted === true };
}
