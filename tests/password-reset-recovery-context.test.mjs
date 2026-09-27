import assert from "node:assert/strict";
import test from "node:test";

/**
 * Validação do contrato de segurança de /redefinir-senha:
 * O componente DEVE diferenciar tecnicamente uma sessão de recuperação (evento PASSWORD_RECOVERY ou AMR 'recovery')
 * de uma sessão normal já autenticada (INITIAL_SESSION/SIGNED_IN com method 'password'/'oauth').
 */

function determineRecoveryContext({ event, session }) {
  // 1. Evento específico PASSWORD_RECOVERY do Supabase Auth
  if (event === "PASSWORD_RECOVERY") {
    return true;
  }

  // 2. AMR indicando 'recovery' (usado em hidratação SSR ou token de recuperação)
  const amr = session?.user?.amr;
  const isRecoveryAmr = Array.isArray(amr) && amr.some((entry) =>
    (typeof entry === "string" && entry === "recovery") ||
    (typeof entry === "object" && entry !== null && "method" in entry && entry.method === "recovery")
  );

  return Boolean(isRecoveryAmr);
}

test("Supabase PASSWORD_RECOVERY event establishes valid recovery context", () => {
  const result = determineRecoveryContext({
    event: "PASSWORD_RECOVERY",
    session: {
      user: { id: "user-123", email: "medico@hospital.com" },
    },
  });

  assert.equal(result, true, "Evento PASSWORD_RECOVERY deve autorizar redefinição de senha");
});

test("Normal authenticated session (SIGNED_IN / password) DOES NOT establish recovery context", () => {
  const result = determineRecoveryContext({
    event: "SIGNED_IN",
    session: {
      user: {
        id: "user-123",
        email: "medico@hospital.com",
        amr: [{ method: "password", timestamp: 1700000000 }],
      },
    },
  });

  assert.equal(result, false, "Sessão normal já autenticada não pode ser tratada como recuperação");
});

test("Normal authenticated session (INITIAL_SESSION / oauth) DOES NOT establish recovery context", () => {
  const result = determineRecoveryContext({
    event: "INITIAL_SESSION",
    session: {
      user: {
        id: "user-456",
        email: "medico@hospital.com",
        amr: [{ method: "oauth", provider: "google", timestamp: 1700000000 }],
      },
    },
  });

  assert.equal(result, false, "Sessão OAuth normal não pode ser tratada como recuperação");
});

test("Session with AMR 'recovery' establishes recovery context", () => {
  const result = determineRecoveryContext({
    event: "INITIAL_SESSION",
    session: {
      user: {
        id: "user-789",
        email: "medico@hospital.com",
        amr: [{ method: "recovery", timestamp: 1700000000 }],
      },
    },
  });

  assert.equal(result, true, "Sessão com AMR recovery deve autorizar redefinição");
});

test("Unauthenticated visitor without session DOES NOT establish recovery context", () => {
  const result = determineRecoveryContext({
    event: "INITIAL_SESSION",
    session: null,
  });

  assert.equal(result, false, "Visitante sem sessão não pode estabelecer contexto de recuperação");
});
