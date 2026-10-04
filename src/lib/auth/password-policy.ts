/**
 * Regra canônica de política de senhas e sanitização/mapeamento de erros de autenticação (MAI-166).
 *
 * Contratos estritos:
 * 1. Comprimento mínimo de 8 caracteres obrigatório no signup e redefinição de senha.
 * 2. Login não bloqueia senhas de 6 ou 7 caracteres para manter compatibilidade com contas legadas.
 * 3. Mapeamento de erros do Supabase Auth avalia EXCLUSIVAMENTE `code` e `status` numérico,
 *    ignorando completamente `message` e `name` para neutralizar injeções adversariais,
 *    evitar vazamento de PII e garantir estabilidade contra mudanças de texto do provedor.
 * 4. Não-enumeração de usuários no login (unificação de invalid_credentials/email_not_confirmed)
 *    e no signup (resposta neutra para user_already_exists).
 */

export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_MIN_LENGTH_MESSAGE = "A senha deve ter pelo menos 8 caracteres.";
export const PASSWORDS_DONT_MATCH_MESSAGE = "As senhas digitadas não coincidem. Verifique e tente novamente.";
export const GENERIC_LOGIN_ERROR_MESSAGE = "E-mail ou senha incorretos. Verifique suas credenciais e tente novamente.";
export const RATE_LIMIT_ERROR_MESSAGE = "Muitas tentativas em sequência. Aguarde alguns instantes antes de tentar novamente.";
export const SIGNUP_SUCCESS_GENERIC_MESSAGE =
  "Confira seu e-mail para confirmar a conta, se o cadastro foi aceito. Veja também a pasta de spam. Após confirmar, volte aqui e entre com sua senha. Se já possui conta, tente entrar.";
export const PASSWORD_SAME_AS_OLD_MESSAGE = "A nova senha deve ser diferente da senha anterior.";
export const PASSWORD_UPDATE_GENERIC_ERROR_MESSAGE = "Não foi possível atualizar a senha. Tente novamente.";
export const RECOVERY_SESSION_EXPIRED_MESSAGE = "Sua sessão de recuperação expirou. Solicite um novo link de recuperação.";
export const NETWORK_ERROR_MESSAGE = "Não foi possível conectar. Verifique sua conexão e tente novamente.";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validação de comprimento mínimo para criação de conta e nova senha (>= 8 caracteres).
 * Nota: Não deve ser aplicada no formulário de login para manter compatibilidade com
 * usuários existentes que possuam senhas anteriores de 6 ou 7 caracteres.
 */
export function validatePasswordLength(password: string): ValidationResult {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: PASSWORD_MIN_LENGTH_MESSAGE };
  }
  return { valid: true };
}

/**
 * Validação composta para fluxo de redefinição de senha:
 * 1. Comprimento mínimo de 8 caracteres.
 * 2. Igualdade exata entre nova senha e confirmação.
 */
export function validatePasswordReset(password: string, confirmPassword: string): ValidationResult {
  const lengthCheck = validatePasswordLength(password);
  if (!lengthCheck.valid) {
    return lengthCheck;
  }
  if (password !== confirmPassword) {
    return { valid: false, error: PASSWORDS_DONT_MATCH_MESSAGE };
  }
  return { valid: true };
}

interface AuthErrorShape {
  status?: number;
  code?: string;
}

/**
 * Extrai unicamente status HTTP e código canônico do erro.
 * Jamais extrai ou processa `message` ou `name` do provedor.
 */
function extractErrorCodeAndStatus(error: unknown): AuthErrorShape {
  if (!error || typeof error !== "object") return {};
  const err = error as Record<string, unknown>;
  const status = typeof err.status === "number" ? err.status : undefined;
  const rawCode = typeof err.code === "string" ? err.code.trim().toLowerCase() : undefined;
  return { status, code: rawCode };
}

function isRateLimit(err: AuthErrorShape): boolean {
  if (err.status === 429) return true;
  return (
    err.code === "over_request_rate_limit" ||
    err.code === "rate_limit_exceeded" ||
    err.code === "over_email_send_rate_limit" ||
    err.code === "over_sms_send_rate_limit"
  );
}

/**
 * Mapeia erros do Supabase Auth no Login para mensagens do produto.
 * Avalia estritamente status/code. Unifica erros de credenciais e e-mail não confirmado
 * para impedir a enumeração de contas existentes.
 */
export function mapLoginAuthError(error: unknown): string {
  const err = extractErrorCodeAndStatus(error);
  if (isRateLimit(err)) {
    return RATE_LIMIT_ERROR_MESSAGE;
  }
  return GENERIC_LOGIN_ERROR_MESSAGE;
}

export type SignupResultAction =
  | { type: "message"; text: string }
  | { type: "error"; text: string };

/**
 * Mapeia erros do Supabase Auth no Cadastro (signup).
 * Avalia estritamente status/code. Se o provedor indicar usuário já existente,
 * oculta a enumeração retornando a mesma mensagem neutra de confirmação por e-mail.
 */
export function mapSignupAuthError(error: unknown): SignupResultAction {
  const err = extractErrorCodeAndStatus(error);

  if (err.code === "weak_password") {
    return { type: "error", text: PASSWORD_MIN_LENGTH_MESSAGE };
  }

  if (isRateLimit(err)) {
    return { type: "error", text: RATE_LIMIT_ERROR_MESSAGE };
  }

  if (
    err.code === "user_already_exists" ||
    err.code === "identity_already_exists" ||
    err.code === "email_exists"
  ) {
    return { type: "message", text: SIGNUP_SUCCESS_GENERIC_MESSAGE };
  }

  return { type: "error", text: "Não foi possível concluir o cadastro. Tente novamente mais tarde." };
}

/**
 * Mapeia erros do Supabase Auth na atualização de senha (redefinição).
 * Avalia estritamente status/code para tratar mesma senha, sessão expirada e rate limits.
 */
export function mapPasswordUpdateError(error: unknown): string {
  const err = extractErrorCodeAndStatus(error);

  if (err.code === "weak_password") {
    return PASSWORD_MIN_LENGTH_MESSAGE;
  }

  if (err.code === "same_password") {
    return PASSWORD_SAME_AS_OLD_MESSAGE;
  }

  if (
    err.code === "session_expired" ||
    err.code === "bad_jwt" ||
    err.code === "token_expired" ||
    err.code === "otp_expired"
  ) {
    return RECOVERY_SESSION_EXPIRED_MESSAGE;
  }

  if (isRateLimit(err)) {
    return RATE_LIMIT_ERROR_MESSAGE;
  }

  return PASSWORD_UPDATE_GENERIC_ERROR_MESSAGE;
}

export interface MinimalSupabaseAuthClient {
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<{
    data: { session?: unknown } | null;
    error: unknown;
  }>;
  signUp: (credentials: { email: string; password: string }) => Promise<{
    data: { session?: unknown } | null;
    error: unknown;
  }>;
}

export interface AuthSubmitParams {
  mode: "login" | "signup";
  email: string;
  password: string;
  client: MinimalSupabaseAuthClient;
}

export type AuthSubmitResult =
  | { status: "validation_error"; error: string }
  | { status: "auth_error"; error: string }
  | { status: "confirmation_required"; message: string }
  | { status: "success" };

/**
 * Manipulador real e compartilhado de submissão de autenticação (Login / Cadastro).
 * Garante que signup < 8 caracteres seja bloqueado antes de chamar o provedor,
 * enquanto login permite qualquer tamanho >= 1 para não rejeitar contas legadas.
 */
export async function processAuthSubmit(params: AuthSubmitParams): Promise<AuthSubmitResult> {
  const { mode, email, password, client } = params;

  if (mode === "signup") {
    const validation = validatePasswordLength(password);
    if (!validation.valid) {
      return {
        status: "validation_error",
        error: validation.error ?? PASSWORD_MIN_LENGTH_MESSAGE,
      };
    }
  }

  const result =
    mode === "login"
      ? await client.signInWithPassword({ email, password })
      : await client.signUp({ email, password });

  if (result.error) {
    if (mode === "login") {
      return {
        status: "auth_error",
        error: mapLoginAuthError(result.error),
      };
    }
    const mapped = mapSignupAuthError(result.error);
    if (mapped.type === "message") {
      return {
        status: "confirmation_required",
        message: mapped.text,
      };
    }
    return {
      status: "auth_error",
      error: mapped.text,
    };
  }

  if (mode === "signup" && !result.data?.session) {
    return {
      status: "confirmation_required",
      message: SIGNUP_SUCCESS_GENERIC_MESSAGE,
    };
  }

  return { status: "success" };
}

export interface MinimalSupabasePasswordResetClient {
  updateUser: (attributes: { password: string }) => Promise<{
    data: unknown;
    error: unknown;
  }>;
}

export interface PasswordResetSubmitParams {
  password: string;
  confirmPassword: string;
  isRecoveryContext: boolean;
  client: MinimalSupabasePasswordResetClient;
}

export type PasswordResetSubmitResult =
  | { status: "unauthorized"; error: string }
  | { status: "validation_error"; error: string }
  | { status: "update_error"; error: string }
  | { status: "success" };

/**
 * Manipulador real e compartilhado de redefinição de nova senha.
 * Exige contexto recovery válido e validação de 8 caracteres + confirmação
 * antes de despachar a chamada updateUser para o provedor.
 */
export async function processPasswordResetSubmit(
  params: PasswordResetSubmitParams
): Promise<PasswordResetSubmitResult> {
  const { password, confirmPassword, isRecoveryContext, client } = params;

  if (!isRecoveryContext) {
    return {
      status: "unauthorized",
      error: RECOVERY_SESSION_EXPIRED_MESSAGE,
    };
  }

  const validation = validatePasswordReset(password, confirmPassword);
  if (!validation.valid) {
    return {
      status: "validation_error",
      error: validation.error ?? "Erro ao validar nova senha.",
    };
  }

  const { error: updateError } = await client.updateUser({ password });
  if (updateError) {
    return {
      status: "update_error",
      error: mapPasswordUpdateError(updateError),
    };
  }

  return { status: "success" };
}
