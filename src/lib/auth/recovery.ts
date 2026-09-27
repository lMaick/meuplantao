/**
 * Regras e utilitários de segurança para validação do contexto de recuperação de senha.
 *
 * Conforme o contrato oficial do Supabase Auth e o RFC 8176, Authentication Method References (AMR)
 * residem exclusivamente nas claims verificadas do access token JWT, não no objeto User.
 */

export function hasRecoveryAmr(amr: unknown): boolean {
  return (
    Array.isArray(amr) &&
    amr.some(
      (entry) =>
        (typeof entry === "string" && entry === "recovery") ||
        (
          typeof entry === "object" &&
          entry !== null &&
          "method" in entry &&
          entry.method === "recovery"
        )
    )
  );
}

export interface SupabaseAuthClientLike {
  getClaims: (jwt?: string) => Promise<{
    data: {
      claims?: {
        amr?: unknown;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    } | null;
    error: unknown;
  }>;
}

/**
 * Inspeciona as claims verificadas retornadas por supabase.auth.getClaims()
 * para confirmar se a sessão provém de um link de recuperação (amr.method === "recovery").
 *
 * Não confia em propriedades artificiais atribuídas a session.user.
 */
export async function verifyRecoveryClaims(auth: SupabaseAuthClientLike): Promise<boolean> {
  try {
    const { data, error } = await auth.getClaims();
    if (error || !data || !data.claims) {
      return false;
    }
    return hasRecoveryAmr(data.claims.amr);
  } catch {
    return false;
  }
}
