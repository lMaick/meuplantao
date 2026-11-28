import { createClient } from "@/lib/supabase/client";
import { throwOnError } from "@/lib/dal";

/**
 * DAL da preferência de avisos por e-mail. Só usa as RPCs próprias
 * (`security definer`, escopo `auth.uid()`); as tabelas não são acessíveis ao usuário.
 */
export async function getEmailAlertsEnabled(): Promise<boolean> {
  const { data, error } = await createClient().rpc("get_my_email_alerts_enabled");
  await throwOnError(error);
  return data !== false;
}

export async function setEmailAlertsEnabled(enabled: boolean): Promise<boolean> {
  const { data, error } = await createClient().rpc("set_my_email_alerts_enabled", { p_enabled: enabled });
  await throwOnError(error);
  return data === true;
}
