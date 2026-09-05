export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou ou é inválida. Entre novamente. Se o problema continuar, confira a data e a hora do seu dispositivo.";
export const SESSION_EXPIRED_URL = "/login?reason=session-expired";

export function isInvalidJwtError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "bad_jwt" || code === "PGRST301" || code === "PGRST303") return true;
  return typeof message === "string" && (
    /\binvalid jwt\b/i.test(message) ||
    /\bjwt\b.*\b(invalid|expired|issued (?:in the |at )?future|not yet valid)\b/i.test(message)
  );
}

// Shared by concurrent DAL calls, including the dashboard's Promise.all.
// Keep the completed promise until navigation replaces this document.
export function createJwtRecovery(
  clearSession: () => Promise<{ error: unknown }>,
  location: { pathname: string; replace: (url: string) => void },
) {
  let recovery: Promise<void> | undefined;
  return async (error: unknown): Promise<boolean> => {
    if (!isInvalidJwtError(error)) return false;
    if (!recovery) {
      recovery = Promise.resolve().then(async () => {
        const result = await clearSession();
        if (result.error) throw new Error("Não foi possível encerrar sua sessão. Tente novamente.", { cause: result.error });
        if (location.pathname !== "/login") location.replace(SESSION_EXPIRED_URL);
      }).catch((cause: unknown) => {
        recovery = undefined;
        throw cause;
      });
    }
    await recovery;
    return true;
  };
}
