import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  PASSWORDS_DONT_MATCH_MESSAGE,
  GENERIC_LOGIN_ERROR_MESSAGE,
  RATE_LIMIT_ERROR_MESSAGE,
  SIGNUP_SUCCESS_GENERIC_MESSAGE,
  PASSWORD_SAME_AS_OLD_MESSAGE,
  PASSWORD_UPDATE_GENERIC_ERROR_MESSAGE,
  RECOVERY_SESSION_EXPIRED_MESSAGE,
  validatePasswordLength,
  validatePasswordReset,
  mapLoginAuthError,
  mapSignupAuthError,
  mapPasswordUpdateError,
} from "../src/lib/auth/password-policy.ts";

test("1. Regra canônica de comprimento mínimo de senha (MAI-166)", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8, "Comprimento canônico obrigatório deve ser 8 caracteres");
});

test("2. Validação de senha: 7 vs 8 caracteres (limiar estrito)", () => {
  // 7 caracteres: estritamente rejeitado
  const sevenChars = validatePasswordLength("1234567");
  assert.equal(sevenChars.valid, false);
  assert.equal(sevenChars.error, PASSWORD_MIN_LENGTH_MESSAGE);

  // 6 caracteres (legado): estritamente rejeitado
  const sixChars = validatePasswordLength("123456");
  assert.equal(sixChars.valid, false);
  assert.equal(sixChars.error, PASSWORD_MIN_LENGTH_MESSAGE);

  // Vazio / nulo: rejeitado
  assert.equal(validatePasswordLength("").valid, false);

  // 8 caracteres: aceito
  const eightChars = validatePasswordLength("12345678");
  assert.equal(eightChars.valid, true);
  assert.equal(eightChars.error, undefined);

  // Mais de 8 caracteres: aceito
  const nineChars = validatePasswordLength("SenhaForte123!");
  assert.equal(nineChars.valid, true);
  assert.equal(nineChars.error, undefined);
});

test("3. Validação composta de redefinição de senha (tamanho + confirmação)", () => {
  // 7 caracteres idênticos: rejeita pelo tamanho mínimo primeiro
  const shortMatched = validatePasswordReset("1234567", "1234567");
  assert.equal(shortMatched.valid, false);
  assert.equal(shortMatched.error, PASSWORD_MIN_LENGTH_MESSAGE);

  // 8 caracteres com confirmação diferente: rejeita por divergência
  const mismatch = validatePasswordReset("senhaValida1", "senhaValida2");
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.error, PASSWORDS_DONT_MATCH_MESSAGE);

  // 8 caracteres com confirmação correta: aceito
  const validReset = validatePasswordReset("senhaValida1", "senhaValida1");
  assert.equal(validReset.valid, true);
  assert.equal(validReset.error, undefined);
});

test("4. Login: unificação de erros contra enumeração de contas", () => {
  // Credenciais inválidas (senha errada ou e-mail inexistente)
  const invalidCreds = mapLoginAuthError({ code: "invalid_credentials", message: "Invalid login credentials" });
  assert.equal(invalidCreds, GENERIC_LOGIN_ERROR_MESSAGE);

  // E-mail não confirmado: DEVE retornar a mesma mensagem genérica de login para não revelar existência da conta
  const unconfirmed = mapLoginAuthError({ code: "email_not_confirmed", message: "Email not confirmed" });
  assert.equal(unconfirmed, GENERIC_LOGIN_ERROR_MESSAGE);

  // Rate limit no login: exibe mensagem orientativa sem expor internals
  const rateLimit = mapLoginAuthError({ status: 429, message: "over_request_rate_limit: rate limit exceeded" });
  assert.equal(rateLimit, RATE_LIMIT_ERROR_MESSAGE);

  const rateLimitByCode = mapLoginAuthError({ code: "over_request_rate_limit" });
  assert.equal(rateLimitByCode, RATE_LIMIT_ERROR_MESSAGE);
});

test("5. Signup: não-enumeração de usuários já registrados", () => {
  // Provedor retorna user_already_exists: oculta e responde como confirmação genérica
  const existingUserCode = mapSignupAuthError({ code: "user_already_exists", message: "User already registered" });
  assert.equal(existingUserCode.type, "message");
  assert.equal(existingUserCode.text, SIGNUP_SUCCESS_GENERIC_MESSAGE);

  const existingUserMsg = mapSignupAuthError({ message: "A user with this email address has already been registered" });
  assert.equal(existingUserMsg.type, "message");
  assert.equal(existingUserMsg.text, SIGNUP_SUCCESS_GENERIC_MESSAGE);

  // Senha fraca rejeitada pelo Supabase Auth backend
  const weakPass = mapSignupAuthError({ code: "weak_password", message: "Password should be at least 8 characters" });
  assert.equal(weakPass.type, "error");
  assert.equal(weakPass.text, PASSWORD_MIN_LENGTH_MESSAGE);

  // Rate limit de criação de conta
  const rateLimit = mapSignupAuthError({ status: 429, message: "too many requests" });
  assert.equal(rateLimit.type, "error");
  assert.equal(rateLimit.text, RATE_LIMIT_ERROR_MESSAGE);

  // Erro inesperado: não expõe stack ou texto do banco
  const genericError = mapSignupAuthError({ message: "Internal server error 500" });
  assert.equal(genericError.type, "error");
  assert.equal(genericError.text, "Não foi possível concluir o cadastro. Tente novamente mais tarde.");
});

test("6. Atualização de senha (redefinição): mapeamento seguro", () => {
  // Senha igual à anterior
  const samePass = mapPasswordUpdateError({ code: "same_password", message: "New password should be different from the old password." });
  assert.equal(samePass, PASSWORD_SAME_AS_OLD_MESSAGE);

  // Sessão de recuperação expirada
  const expiredJwt = mapPasswordUpdateError({ code: "bad_jwt", message: "token has expired or is invalid" });
  assert.equal(expiredJwt, RECOVERY_SESSION_EXPIRED_MESSAGE);

  const expiredSession = mapPasswordUpdateError({ code: "session_expired", message: "Auth session missing!" });
  assert.equal(expiredSession, RECOVERY_SESSION_EXPIRED_MESSAGE);

  // Rate limit
  const rateLimit = mapPasswordUpdateError({ status: 429 });
  assert.equal(rateLimit, RATE_LIMIT_ERROR_MESSAGE);

  // Fallback padrão sem expor mensagem bruta
  const rawProviderError = mapPasswordUpdateError({ message: "Database constraint auth_users_encrypted_password_check failed" });
  assert.equal(rawProviderError, PASSWORD_UPDATE_GENERIC_ERROR_MESSAGE);
});
