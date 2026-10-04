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
  processAuthSubmit,
  processPasswordResetSubmit,
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

test("4. Login: unificação estrita de erros contra enumeração de contas", () => {
  // Credenciais inválidas (senha errada ou e-mail inexistente)
  const invalidCreds = mapLoginAuthError({ code: "invalid_credentials" });
  assert.equal(invalidCreds, GENERIC_LOGIN_ERROR_MESSAGE);

  // E-mail não confirmado: DEVE retornar a mesma mensagem genérica de login para não revelar existência da conta
  const unconfirmed = mapLoginAuthError({ code: "email_not_confirmed" });
  assert.equal(unconfirmed, GENERIC_LOGIN_ERROR_MESSAGE);

  // Erro desconhecido ou genérico no login: unifica na mensagem neutra
  const unknownError = mapLoginAuthError({ code: "user_not_found" });
  assert.equal(unknownError, GENERIC_LOGIN_ERROR_MESSAGE);

  // Rate limit no login (por status 429 ou code)
  const rateLimitStatus = mapLoginAuthError({ status: 429 });
  assert.equal(rateLimitStatus, RATE_LIMIT_ERROR_MESSAGE);

  const rateLimitByCode = mapLoginAuthError({ code: "over_request_rate_limit" });
  assert.equal(rateLimitByCode, RATE_LIMIT_ERROR_MESSAGE);
});

test("5. Signup: não-enumeração de usuários já registrados via status/code", () => {
  // Provedor retorna user_already_exists / identity_already_exists: oculta e responde como confirmação genérica
  const existingUserCode = mapSignupAuthError({ code: "user_already_exists" });
  assert.equal(existingUserCode.type, "message");
  assert.equal(existingUserCode.text, SIGNUP_SUCCESS_GENERIC_MESSAGE);

  const identityExists = mapSignupAuthError({ code: "identity_already_exists" });
  assert.equal(identityExists.type, "message");
  assert.equal(identityExists.text, SIGNUP_SUCCESS_GENERIC_MESSAGE);

  const emailExists = mapSignupAuthError({ code: "email_exists" });
  assert.equal(emailExists.type, "message");
  assert.equal(emailExists.text, SIGNUP_SUCCESS_GENERIC_MESSAGE);

  // Senha fraca rejeitada pelo Supabase Auth backend
  const weakPass = mapSignupAuthError({ code: "weak_password" });
  assert.equal(weakPass.type, "error");
  assert.equal(weakPass.text, PASSWORD_MIN_LENGTH_MESSAGE);

  // Rate limit de criação de conta
  const rateLimit = mapSignupAuthError({ status: 429 });
  assert.equal(rateLimit.type, "error");
  assert.equal(rateLimit.text, RATE_LIMIT_ERROR_MESSAGE);

  // Erro genérico/inesperado: não expõe stack ou texto do banco
  const genericError = mapSignupAuthError({ code: "database_error" });
  assert.equal(genericError.type, "error");
  assert.equal(genericError.text, "Não foi possível concluir o cadastro. Tente novamente mais tarde.");
});

test("6. Atualização de senha (redefinição): mapeamento seguro via status/code", () => {
  // Senha igual à anterior
  const samePass = mapPasswordUpdateError({ code: "same_password" });
  assert.equal(samePass, PASSWORD_SAME_AS_OLD_MESSAGE);

  // Sessão de recuperação expirada (tokens e sessão)
  assert.equal(mapPasswordUpdateError({ code: "bad_jwt" }), RECOVERY_SESSION_EXPIRED_MESSAGE);
  assert.equal(mapPasswordUpdateError({ code: "session_expired" }), RECOVERY_SESSION_EXPIRED_MESSAGE);
  assert.equal(mapPasswordUpdateError({ code: "token_expired" }), RECOVERY_SESSION_EXPIRED_MESSAGE);
  assert.equal(mapPasswordUpdateError({ code: "otp_expired" }), RECOVERY_SESSION_EXPIRED_MESSAGE);

  // Rate limit
  assert.equal(mapPasswordUpdateError({ status: 429 }), RATE_LIMIT_ERROR_MESSAGE);
  assert.equal(mapPasswordUpdateError({ code: "over_request_rate_limit" }), RATE_LIMIT_ERROR_MESSAGE);

  // Senha fraca no backend
  assert.equal(mapPasswordUpdateError({ code: "weak_password" }), PASSWORD_MIN_LENGTH_MESSAGE);

  // Fallback padrão sem expor mensagem bruta
  assert.equal(mapPasswordUpdateError({ code: "unknown_db_constraint" }), PASSWORD_UPDATE_GENERIC_ERROR_MESSAGE);
});

test("7. Regressão adversarial: imunidade a injeções em message/name e vazamento de PII", () => {
  // Caso 1: code é same_password, mas message contém substring de rate limit e PII
  const adversarialSamePass = mapPasswordUpdateError({
    code: "same_password",
    message: "rate limit exceeded for user medico@hospital.com",
    name: "RateLimitError",
  });
  assert.equal(
    adversarialSamePass,
    PASSWORD_SAME_AS_OLD_MESSAGE,
    "Deve respeitar estritamente o code same_password e ignorar a message adversarial"
  );

  // Caso 2: code desconhecido, mas message tenta induzir confirmação neutra simulando already registered
  const adversarialUnknownSignup = mapSignupAuthError({
    code: "internal_error",
    message: "A user with this email address has already been registered with email medico@hospital.com",
    name: "UserAlreadyRegisteredError",
  });
  assert.equal(
    adversarialUnknownSignup.type,
    "error",
    "Code desconhecido não deve mudar ação para confirmação neutra baseado na message bruta"
  );
  assert.equal(
    adversarialUnknownSignup.text,
    "Não foi possível concluir o cadastro. Tente novamente mais tarde."
  );

  // Caso 3: status 429 com message contendo credenciais ou texto de senha igual
  const adversarialRateLimit = mapLoginAuthError({
    status: 429,
    message: "Invalid login credentials for doctor dr.maick@hospital.com",
  });
  assert.equal(
    adversarialRateLimit,
    RATE_LIMIT_ERROR_MESSAGE,
    "Status 429 prevalece sobre qualquer message adversarial"
  );

  // Caso 4: invalid_credentials com message contendo token JWT ou detalhes de rate limit
  const adversarialInvalidCreds = mapLoginAuthError({
    code: "invalid_credentials",
    message: "too many requests; token eyJhbGciOi... leaked",
  });
  assert.equal(
    adversarialInvalidCreds,
    GENERIC_LOGIN_ERROR_MESSAGE,
    "Credenciais inválidas devem retornar mensagem padrão neutra independente de message"
  );

  // Caso 5: user_already_exists com message contendo weak_password
  const adversarialUserExists = mapSignupAuthError({
    code: "user_already_exists",
    message: "password should be at least 8 characters",
  });
  assert.equal(
    adversarialUserExists.type,
    "message",
    "Code user_already_exists deve emitir confirmação neutra sem desvio por message"
  );
  assert.equal(adversarialUserExists.text, SIGNUP_SUCCESS_GENERIC_MESSAGE);
});

test("8. Comportamento do manipulador real de autenticação (processAuthSubmit)", async () => {
  let signUpCalls = 0;
  let signInCalls = 0;

  const mockClient = {
    signUp: async () => {
      signUpCalls++;
      return { data: { session: null }, error: null };
    },
    signInWithPassword: async () => {
      signInCalls++;
      return { data: { session: {} }, error: null };
    },
  };

  // 8.1 Signup com 7 caracteres: bloqueado ANTES de chamar signUp
  const signup7Result = await processAuthSubmit({
    mode: "signup",
    email: "medico@hospital.com",
    password: "1234567",
    client: mockClient,
  });
  assert.equal(signup7Result.status, "validation_error");
  assert.equal(signup7Result.error, PASSWORD_MIN_LENGTH_MESSAGE);
  assert.equal(signUpCalls, 0, "signUp NÃO deve ser chamado para senha < 8 caracteres");

  // 8.2 Signup com 8 caracteres: chama signUp com sucesso
  const signup8Result = await processAuthSubmit({
    mode: "signup",
    email: "medico@hospital.com",
    password: "12345678",
    client: mockClient,
  });
  assert.equal(signup8Result.status, "confirmation_required");
  assert.equal(signUpCalls, 1, "signUp DEVE ser chamado para senha >= 8 caracteres");

  // 8.3 Login com 6 caracteres: NÃO bloqueia e chama signInWithPassword (compatibilidade de contas legadas)
  const login6Result = await processAuthSubmit({
    mode: "login",
    email: "medico@hospital.com",
    password: "123456",
    client: mockClient,
  });
  assert.equal(login6Result.status, "success");
  assert.equal(signInCalls, 1, "signInWithPassword DEVE ser chamado para login com 6 caracteres legados");

  // 8.4 Login com 7 caracteres: NÃO bloqueia e chama signInWithPassword
  const login7Result = await processAuthSubmit({
    mode: "login",
    email: "medico@hospital.com",
    password: "1234567",
    client: mockClient,
  });
  assert.equal(login7Result.status, "success");
  assert.equal(signInCalls, 2, "signInWithPassword DEVE ser chamado para login com 7 caracteres legados");
});

test("9. Comportamento do manipulador real de redefinição (processPasswordResetSubmit)", async () => {
  let updateUserCalls = 0;

  const mockResetClient = {
    updateUser: async () => {
      updateUserCalls++;
      return { data: {}, error: null };
    },
  };

  // 9.1 Recovery não autorizado (link expirado/sem claims): bloqueia updateUser
  const unauthorizedResult = await processPasswordResetSubmit({
    password: "SenhaValida123!",
    confirmPassword: "SenhaValida123!",
    isRecoveryContext: false,
    client: mockResetClient,
  });
  assert.equal(unauthorizedResult.status, "unauthorized");
  assert.equal(unauthorizedResult.error, RECOVERY_SESSION_EXPIRED_MESSAGE);
  assert.equal(updateUserCalls, 0, "updateUser NUNCA deve ser chamado fora do contexto recovery");

  // 9.2 Senha com 7 caracteres no recovery válido: bloqueia updateUser
  const reset7Result = await processPasswordResetSubmit({
    password: "1234567",
    confirmPassword: "1234567",
    isRecoveryContext: true,
    client: mockResetClient,
  });
  assert.equal(reset7Result.status, "validation_error");
  assert.equal(reset7Result.error, PASSWORD_MIN_LENGTH_MESSAGE);
  assert.equal(updateUserCalls, 0, "updateUser NUNCA deve ser chamado para senha < 8 caracteres");

  // 9.3 Confirmação divergente no recovery válido: bloqueia updateUser
  const resetMismatchResult = await processPasswordResetSubmit({
    password: "SenhaValida123!",
    confirmPassword: "OutraSenha123!",
    isRecoveryContext: true,
    client: mockResetClient,
  });
  assert.equal(resetMismatchResult.status, "validation_error");
  assert.equal(resetMismatchResult.error, PASSWORDS_DONT_MATCH_MESSAGE);
  assert.equal(updateUserCalls, 0, "updateUser NUNCA deve ser chamado com senhas divergentes");

  // 9.4 Senha >= 8 caracteres com confirmação e recovery válido: chama updateUser
  const resetValidResult = await processPasswordResetSubmit({
    password: "SenhaValida123!",
    confirmPassword: "SenhaValida123!",
    isRecoveryContext: true,
    client: mockResetClient,
  });
  assert.equal(resetValidResult.status, "success");
  assert.equal(updateUserCalls, 1, "updateUser DEVE ser chamado quando recovery, tamanho e confirmação forem válidos");
});
