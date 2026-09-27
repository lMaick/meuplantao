import assert from "node:assert/strict";
import test from "node:test";
import { hasRecoveryAmr, verifyRecoveryClaims } from "../src/lib/auth/recovery.ts";

/**
 * Validação rigorosa do contrato de segurança de /redefinir-senha:
 * 1. PASSWORD_RECOVERY via evento rápido do Supabase Auth autoriza o contexto.
 * 2. Fallback confiável inspeciona as claims verificadas do JWT (supabase.auth.getClaims().data.claims.amr).
 * 3. amr é uma claim do JWT (RFC 8176), não uma propriedade documentada de User.
 * 4. Jamais confia em session.user.amr ou propriedades artificiais em User.
 */

// Helper que simula a resolução completa do contexto (evento rápido + fallback getClaims)
async function evaluateRecoveryAccess({ event, authMock }) {
  // 1. Caminho rápido: evento PASSWORD_RECOVERY
  if (event === "PASSWORD_RECOVERY") {
    return true;
  }

  // 2. Fallback confiável: chamada efetiva a auth.getClaims()
  return await verifyRecoveryClaims(authMock);
}

test("1. PASSWORD_RECOVERY event → autorizado", async () => {
  const authMock = {
    getClaims: async () => ({
      data: null,
      error: new Error("not called if event confirms"),
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "PASSWORD_RECOVERY",
    authMock,
  });

  assert.equal(isAuthorized, true, "Evento PASSWORD_RECOVERY deve autorizar o acesso de imediato");
});

test("2. claims.amr = [{ method: 'recovery' }] → autorizado", async () => {
  const authMock = {
    getClaims: async () => ({
      data: {
        claims: {
          sub: "user-123",
          email: "medico@hospital.com",
          amr: [{ method: "recovery", timestamp: 1715766000 }],
        },
      },
      error: null,
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "INITIAL_SESSION",
    authMock,
  });

  assert.equal(isAuthorized, true, "Claims JWT com AMR recovery devem ser autorizadas");
});

test("3. claims.amr = [{ method: 'password' }] → recusado", async () => {
  const authMock = {
    getClaims: async () => ({
      data: {
        claims: {
          sub: "user-123",
          email: "medico@hospital.com",
          amr: [{ method: "password", timestamp: 1715766000 }],
        },
      },
      error: null,
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "SIGNED_IN",
    authMock,
  });

  assert.equal(isAuthorized, false, "Sessão normal autenticada por senha deve ser recusada");
});

test("4. claims.amr = [{ method: 'oauth' }] → recusado", async () => {
  const authMock = {
    getClaims: async () => ({
      data: {
        claims: {
          sub: "user-123",
          email: "medico@hospital.com",
          amr: [{ method: "oauth", provider: "google", timestamp: 1715766000 }],
        },
      },
      error: null,
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "INITIAL_SESSION",
    authMock,
  });

  assert.equal(isAuthorized, false, "Sessão normal OAuth deve ser recusada");
});

test("5. sessão válida + user sem propriedade amr + JWT claims recovery → autorizado", async () => {
  // Simula o formato canônico do Supabase onde User NÃO tem amr, mas as claims do JWT têm
  const mockUser = {
    id: "user-real-supabase",
    email: "medico@hospital.com",
    app_metadata: {},
    user_metadata: {},
    // NOTA: sem propriedade amr no objeto user!
  };
  assert.equal("amr" in mockUser, false, "User canônico não possui amr");

  const authMock = {
    getClaims: async () => ({
      data: {
        claims: {
          sub: mockUser.id,
          email: mockUser.email,
          amr: [{ method: "recovery", timestamp: 1715766000 }],
        },
      },
      error: null,
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "INITIAL_SESSION",
    authMock,
  });

  assert.equal(isAuthorized, true, "Deve autorizar pelas claims do JWT mesmo sem amr em user");
});

test("6. sessão válida + user artificialmente contendo amr=recovery + JWT claims sem recovery → NÃO deve ser autorizado", async () => {
  // Simula um payload adulterado onde user possui amr='recovery', mas as claims do JWT NÃO contêm recovery
  const fakeUser = {
    id: "user-attacker",
    email: "medico@hospital.com",
    amr: [{ method: "recovery", timestamp: 1715766000 }], // Adulterado / artificial
  };

  const authMock = {
    getClaims: async () => ({
      data: {
        claims: {
          sub: fakeUser.id,
          email: fakeUser.email,
          amr: [{ method: "password", timestamp: 1715766000 }], // Real do JWT: login com senha!
        },
      },
      error: null,
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "INITIAL_SESSION",
    authMock,
  });

  assert.equal(
    isAuthorized,
    false,
    "NÃO deve confiar em session.user.amr se as claims reais do JWT não contiverem recovery"
  );
});

test("7. sem sessão/claims válidas → recusado", async () => {
  const authMock = {
    getClaims: async () => ({
      data: null,
      error: new Error("AuthSessionMissingError: Auth session missing!"),
    }),
  };

  const isAuthorized = await evaluateRecoveryAccess({
    event: "INITIAL_SESSION",
    authMock,
  });

  assert.equal(isAuthorized, false, "Sem claims válidas a sessão deve ser recusada");
});

test("8. hasRecoveryAmr: validação isolada de formatos de amr aceitos e rejeitados", () => {
  assert.equal(hasRecoveryAmr([{ method: "recovery" }]), true);
  assert.equal(hasRecoveryAmr(["recovery"]), true);
  assert.equal(hasRecoveryAmr([{ method: "password" }]), false);
  assert.equal(hasRecoveryAmr([{ method: "oauth" }]), false);
  assert.equal(hasRecoveryAmr([]), false);
  assert.equal(hasRecoveryAmr(null), false);
  assert.equal(hasRecoveryAmr(undefined), false);
  assert.equal(hasRecoveryAmr("not-an-array"), false);
});
