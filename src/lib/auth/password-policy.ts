/**
 * Regra canônica de política de senhas e sanitização/mapeamento de erros de autenticação.
 * Centraliza o comprimento mínimo (8 caracteres) e mensagens amigáveis de produto (MAI-166).
 *
 * Previne enumeração de usuários unificando erros de credenciais e preservando confirmações genéricas.
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
  message?: string;
  name?: string;
}

function extractErrorProps(error: unknown): AuthErrorShape {
  if (!error || typeof error !== "object") return {};
  const err = error as Record<string, unknown>;
  return {
    status: typeof err.status === "number" ? err.status : undefined,
    code: typeof err.code === "string" ? err.code : undefined,
    message: typeof err.message === "string" ? err.message : undefined,
    name: typeof err.name === "string" ? err.name : undefined,
  };
}

function isRateLimitError(err: AuthErrorShape): boolean {
  if (err.status === 429) return true;
  if (err.code === "over_request_rate_limit" || err.code === "rate_limit_exceeded") return true;
  const msg = err.message?.toLowerCase() ?? "";
  return msg.includes("rate limit") || msg.includes("too many requests");
}

function isWeakPasswordError(err: AuthErrorShape): boolean {
  if (err.code === "weak_password") return true;
  const msg = err.message?.toLowerCase() ?? "";
  return (
    msg.includes("password should be at least") ||
    msg.includes("password is too short") ||
    msg.includes("weak password")
  );
}

/**
 * Mapeia erros do Supabase Auth no Login para mensagens do produto.
 * Unifica invalid_credentials e email_not_confirmed para impedir a enumeração de contas existentes.
 */
export function mapLoginAuthError(error: unknown): string {
  const err = extractErrorProps(error);
  if (isRateLimitError(err)) {
    return RATE_LIMIT_ERROR_MESSAGE;
  }
  return GENERIC_LOGIN_ERROR_MESSAGE;
}

export type SignupResultAction =
  | { type: "message"; text: string }
  | { type: "error"; text: string };

/**
 * Mapeia erros do Supabase Auth no Cadastro (signup).
 * Se o provedor retornar que o usuário já existe (user_already_exists), oculta a enumeração
 * retornando a mesma mensagem neutra de confirmação por e-mail.
 */
export function mapSignupAuthError(error: unknown): SignupResultAction {
  const err = extractErrorProps(error);

  if (isWeakPasswordError(err)) {
    return { type: "error", text: PASSWORD_MIN_LENGTH_MESSAGE };
  }

  if (isRateLimitError(err)) {
    return { type: "error", text: RATE_LIMIT_ERROR_MESSAGE };
  }

  // Prevenção estrita de enumeração de contas cadastradas
  const msg = err.message?.toLowerCase() ?? "";
  const isAlreadyExists =
    err.code === "user_already_exists" ||
    err.code === "identity_already_exists" ||
    msg.includes("already registered") ||
    msg.includes("already been registered") ||
    msg.includes("already in use") ||
    msg.includes("already exists");

  if (isAlreadyExists) {
    return { type: "message", text: SIGNUP_SUCCESS_GENERIC_MESSAGE };
  }

  return { type: "error", text: "Não foi possível concluir o cadastro. Tente novamente mais tarde." };
}

/**
 * Mapeia erros do Supabase Auth na atualização de senha (redefinição).
 * Trata erros conhecidos (senha idêntica, sessão expirada, rate limit) sem expor mensagens brutas.
 */
export function mapPasswordUpdateError(error: unknown): string {
  const err = extractErrorProps(error);

  if (isWeakPasswordError(err)) {
    return PASSWORD_MIN_LENGTH_MESSAGE;
  }

  if (isRateLimitError(err)) {
    return RATE_LIMIT_ERROR_MESSAGE;
  }

  const msg = err.message?.toLowerCase() ?? "";
  const code = err.code?.toLowerCase() ?? "";

  if (
    code === "same_password" ||
    msg.includes("same as old") ||
    msg.includes("different from the old") ||
    msg.includes("should be different")
  ) {
    return PASSWORD_SAME_AS_OLD_MESSAGE;
  }

  if (
    code === "session_expired" ||
    code === "bad_jwt" ||
    msg.includes("jwt") ||
    msg.includes("session") ||
    msg.includes("expired") ||
    msg.includes("invalid token")
  ) {
    return RECOVERY_SESSION_EXPIRED_MESSAGE;
  }

  return PASSWORD_UPDATE_GENERIC_ERROR_MESSAGE;
}
