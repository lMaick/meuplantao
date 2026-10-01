import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const dalUrl = pathToFileURL(path.join(ROOT, "src", "lib", "subscription", "queries.ts")).href;
const trialUrl = pathToFileURL(path.join(ROOT, "src", "lib", "subscription", "trial.ts")).href;
const supabaseClientUrl = pathToFileURL(path.join(ROOT, "src", "lib", "supabase", "client.ts")).href;
const dalModuleUrl = pathToFileURL(path.join(ROOT, "src", "lib", "dal.ts")).href;
const jwtRecoveryUrl = pathToFileURL(path.join(ROOT, "src", "lib", "auth", "jwt-recovery.ts")).href;
const supabaseConfigUrl = pathToFileURL(path.join(ROOT, "src", "lib", "supabase", "config.ts")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase/client") return { url: supabaseClientUrl, shortCircuit: true };
    if (specifier === "@/lib/supabase/config") return { url: supabaseConfigUrl, shortCircuit: true };
    if (specifier === "@/lib/dal") return { url: dalModuleUrl, shortCircuit: true };
    if (specifier === "@/lib/auth/jwt-recovery") return { url: jwtRecoveryUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/queries") return { url: dalUrl, shortCircuit: true };
    if (specifier === "@/lib/subscription/trial") return { url: trialUrl, shortCircuit: true };
    if (specifier === "@supabase/ssr") {
      return { url: "data:text/javascript,export function createBrowserClient(){throw new Error('mocked');}", shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (fs.existsSync(new URL(`${resolved.href}.ts`))) return nextResolve(`${resolved.href}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const dal = await import("../src/lib/subscription/queries.ts");
const { calculateTrial } = await import("../src/lib/subscription/trial.ts");
const { SESSION_EXPIRED_MESSAGE } = await import("../src/lib/auth/jwt-recovery.ts");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-19T12:00:00.000Z");

function mockClient({ user, subscriptionRow, subscriptionError = null, userError = null }) {
  const state = { eqUserId: null, removed: null };
  return {
    __state: state,
    auth: {
      getUser: async () => {
        if (userError) return { data: { user: null }, error: userError };
        if (!user) return { data: { user: null }, error: null };
        return { data: { user }, error: null };
      },
    },
    from: (table) => {
      assert.equal(table, "subscriptions");
      return {
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, "user_id");
            state.eqUserId = val;
            return {
              maybeSingle: async () => {
                if (subscriptionError) return { data: null, error: subscriptionError };
                return { data: subscriptionRow ?? null, error: null };
              },
            };
          },
        }),
      };
    },
    channel: (name) => {
      const handlers = [];
      const channelObj = {
        __name: name,
        __handlers: handlers,
        on: (type, params, cb) => {
          handlers.push({ type, params, cb });
          return channelObj;
        },
        subscribe: () => channelObj,
      };
      return channelObj;
    },
    removeChannel: async (ch) => {
      state.removed = ch;
      return {};
    },
  };
}

// Replica fiel do ramo de falha do SubscriptionProvider pós-MAI-143:
// auth failure => limpa tudo e volta a trial anônimo (nunca prev Pro).
function simulateProviderFailure(prevTrial, prevUserId, prevCreatedAt, error) {
  const normalized = error instanceof Error ? error : new Error("Erro ao carregar dados de assinatura");
  if (dal.isSubscriptionAuthFailure(normalized)) {
    return {
      userId: null,
      createdAt: null,
      trial: calculateTrial(NOW.toISOString(), null, NOW, null),
      error: dal.isSessionExpiredError(normalized) ? normalized : null,
    };
  }
  return {
    userId: prevUserId,
    createdAt: prevCreatedAt,
    trial: prevTrial ?? calculateTrial(NOW.toISOString(), null, NOW, null),
    error: normalized,
  };
}

describe("MAI-143 regressão: sessão perdida/expirada limpa Pro stale", () => {
  test("helpers classificam ausência vs expiração vs transitório", () => {
    assert.equal(dal.UNAUTHENTICATED_MESSAGE, "Usuário não autenticado.");
    assert.ok(dal.isSubscriptionAuthFailure(new Error(dal.UNAUTHENTICATED_MESSAGE)));
    assert.ok(dal.isSubscriptionAuthFailure(new Error(SESSION_EXPIRED_MESSAGE)));
    assert.ok(!dal.isSubscriptionAuthFailure(new Error("network down")));
    assert.ok(dal.isSessionExpiredError(new Error(SESSION_EXPIRED_MESSAGE)));
    assert.ok(!dal.isSessionExpiredError(new Error(dal.UNAUTHENTICATED_MESSAGE)));
    assert.ok(!dal.isSessionExpiredError(new Error("network down")));
  });

  test("Pro → sessão expirada (JWT): Pro antigo não permanece ativo", async () => {
    // Estado anterior: usuário Pro ativo.
    const oldCreated = new Date(NOW.getTime() - 60 * 86400000).toISOString();
    const futureEnd = new Date(NOW.getTime() + 30 * 86400000).toISOString();
    const prevPro = calculateTrial(oldCreated, "active", NOW, futureEnd);
    assert.equal(prevPro.isActive, true);

    // DAL propaga SESSION_EXPIRED em vez de vazar dados.
    const jwtError = new Error("invalid jwt expired");
    jwtError.code = "bad_jwt";
    const client = mockClient({ user: null, userError: jwtError });
    await assert.rejects(() => dal.fetchMySubscription(client), /sessão expirou|expired|invalid jwt/i);

    // Provider: limpa userId/createdAt, trial anônimo não-Pro, erro visível.
    const expired = new Error(SESSION_EXPIRED_MESSAGE);
    const next = simulateProviderFailure(prevPro, USER_A, oldCreated, expired);
    assert.equal(next.userId, null);
    assert.equal(next.createdAt, null);
    assert.equal(next.trial.isActive, false, "Pro stale não pode permanecer ativo");
    assert.equal(next.trial.proDaysRemaining ?? 0, 0);
    assert.ok(next.error, "JWT expirado deve expor erro para pedir re-login");
  });

  test("Pro → sessão ausente (logout): volta a trial anônimo silencioso, sem Pro", () => {
    const oldCreated = new Date(NOW.getTime() - 60 * 86400000).toISOString();
    const futureEnd = new Date(NOW.getTime() + 30 * 86400000).toISOString();
    const prevPro = calculateTrial(oldCreated, "active", NOW, futureEnd);
    assert.equal(prevPro.isActive, true);

    const next = simulateProviderFailure(prevPro, USER_A, oldCreated, new Error(dal.UNAUTHENTICATED_MESSAGE));
    assert.equal(next.userId, null);
    assert.equal(next.createdAt, null);
    assert.equal(next.trial.isActive, false);
    assert.equal(next.error, null, "sessão ausente não expõe erro");
  });

  test("isolamento A→B: troca de sessão substitui estado, nunca mescla", async () => {
    const oldCreated = new Date(NOW.getTime() - 60 * 86400000).toISOString();
    const futureEnd = new Date(NOW.getTime() + 10 * 86400000).toISOString();
    const clientA = mockClient({
      user: { id: USER_A, created_at: oldCreated },
      subscriptionRow: { status: "active", current_period_end: futureEnd },
    });
    const clientB = mockClient({
      user: { id: USER_B, created_at: NOW.toISOString() },
      subscriptionRow: null,
    });
    const a = await dal.fetchMySubscription(clientA);
    const b = await dal.fetchMySubscription(clientB);
    assert.equal(clientA.__state.eqUserId, USER_A);
    assert.equal(clientB.__state.eqUserId, USER_B);
    const trialA = calculateTrial(a.createdAt, a.subscription?.status, NOW, a.subscription?.current_period_end);
    const trialB = calculateTrial(b.createdAt, b.subscription?.status, NOW, b.subscription?.current_period_end);
    assert.equal(trialA.isActive, true, "A é Pro");
    assert.equal(trialB.isActive, false, "B não herda Pro de A");
    assert.notEqual(a.userId, b.userId);

    // Realtime: canais e filtros distintos por usuário.
    assert.notEqual(dal.subscriptionChannelName(USER_A), dal.subscriptionChannelName(USER_B));
    assert.notEqual(dal.subscriptionRealtimeFilter(USER_A), dal.subscriptionRealtimeFilter(USER_B));

    // Logout entre A e B: estado de A é descartado antes de carregar B.
    const cleared = simulateProviderFailure(trialA, USER_A, oldCreated, new Error(dal.UNAUTHENTICATED_MESSAGE));
    assert.equal(cleared.userId, null);
    assert.equal(cleared.trial.isActive, false);
  });

  test("falha transitória (rede) preserva para retry — auth failure nunca preserva prev", () => {
    const prevPro = calculateTrial(
      new Date(NOW.getTime() - 60 * 86400000).toISOString(),
      "active",
      NOW,
      new Date(NOW.getTime() + 30 * 86400000).toISOString(),
    );
    const transient = simulateProviderFailure(prevPro, USER_A, NOW.toISOString(), new Error("network down"));
    assert.equal(transient.userId, USER_A, "rede mantém userId para retry");
    assert.equal(transient.trial.isActive, true, "rede pode preservar para evitar flicker");

    const authCleared = simulateProviderFailure(prevPro, USER_A, NOW.toISOString(), new Error(SESSION_EXPIRED_MESSAGE));
    assert.equal(authCleared.trial.isActive, false, "auth failure nunca preserva Pro");
  });

  test("fonte do provider/hook limpa estado em falha de auth (estático)", () => {
    const provider = read("src/lib/subscription/subscription-provider.tsx");
    assert.match(provider, /isSubscriptionAuthFailure/, "provider usa helper de falha de auth");
    assert.match(provider, /setUserId\(null\)/);
    assert.ok(!provider.includes("setUserId((prev)"), "provider não preserva userId stale");
    assert.ok(
      !provider.includes("prev ?? calculateTrial(createdAt"),
      "provider não preserva trial stale a partir de createdAt do closure",
    );

    const hook = read("src/lib/subscription/use-subscription.ts");
    assert.match(hook, /isSubscriptionAuthFailure/, "hook usa helper de falha de auth");
    // Hook fallback é fail-closed: qualquer erro volta a trial anônimo.
    assert.match(hook, /calculateTrial\(new Date\(\)\.toISOString\(\),\s*null\)/);
  });

  test("realtime: canal antigo removido na troca/logout", async () => {
    const client = mockClient({ user: { id: USER_A, created_at: NOW.toISOString() }, subscriptionRow: null });
    let calls = 0;
    const chA = dal.createSubscriptionChannel(client, USER_A, () => calls++, "provider");
    assert.equal(chA.__handlers[0].params.filter, `user_id=eq.${USER_A}`);
    await dal.removeSubscriptionChannel(client, chA);
    assert.equal(client.__state.removed, chA, "logout/troca remove canal antigo de A");
    const chB = dal.createSubscriptionChannel(client, USER_B, () => calls++, "provider");
    assert.notEqual(chA.__name, chB.__name);
    assert.equal(chB.__handlers[0].params.filter, `user_id=eq.${USER_B}`);
  });
});
