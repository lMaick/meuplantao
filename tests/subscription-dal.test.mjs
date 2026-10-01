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
const { calculateTrial, canCreateShift } = await import("../src/lib/subscription/trial.ts");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-19T12:00:00.000Z");

// ---- Mocks ----

function mockClient({ user, subscriptionRow, subscriptionError = null, userError = null, captures = null }) {
  const state = { eqUserId: null, subscribed: null };
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
        select: (cols) => {
          if (captures) captures.select = cols;
          return {
            eq: (col, val) => {
              assert.equal(col, "user_id");
              state.eqUserId = val;
              if (captures) captures.eqUserId = val;
              return {
                maybeSingle: async () => {
                  if (subscriptionError) return { data: null, error: subscriptionError };
                  return { data: subscriptionRow ?? null, error: null };
                },
              };
            },
          };
        },
      };
    },
    channel: (name) => {
      const handlers = [];
      const channelObj = {
        __name: name,
        __handlers: handlers,
        on: (type, params, cb) => {
          handlers.push({ type, params, cb });
          state.subscribed = { name, params };
          if (captures) captures.channel = { name, params };
          return channelObj;
        },
        subscribe: () => channelObj,
      };
      return channelObj;
    },
    removeChannel: async (ch) => {
      state.removed = ch;
      if (captures) captures.removed = ch;
      return {};
    },
  };
}

describe("MAI-143: DAL de assinatura (fronteira de camadas)", () => {
  describe("arquitetura: provider/hook sem query inline", () => {
    test("SubscriptionProvider delega à DAL e não contém query inline", () => {
      const src = read("src/lib/subscription/subscription-provider.tsx");
      assert.ok(!src.includes('.from("subscriptions")'), "provider não deve ter .from subscriptions inline");
      assert.ok(!src.includes(".from('subscriptions')"), "provider não deve ter .from subscriptions inline");
      assert.ok(!src.includes("service_role"), "provider nunca usa service_role");
      assert.match(src, /fetchMySubscription/, "provider usa fetchMySubscription da DAL");
      assert.match(src, /createSubscriptionChannel/, "provider usa createSubscriptionChannel da DAL");
      assert.match(src, /from\s*["']\.\/queries["']/, "provider importa da DAL ./queries");
    });

    test("useSubscription fallback delega à DAL e não contém query inline", () => {
      const src = read("src/lib/subscription/use-subscription.ts");
      assert.ok(!src.includes('.from("subscriptions")'), "hook não deve ter query inline");
      assert.ok(!src.includes("service_role"), "hook nunca usa service_role");
      assert.match(src, /fetchMySubscription/);
      assert.match(src, /createSubscriptionChannel/);
      assert.match(src, /from\s*["']\.\/queries["']/);
    });

    test("DAL centraliza acesso condicionado ao usuário autenticado + RLS", () => {
      const src = read("src/lib/subscription/queries.ts");
      assert.match(src, /from\(SUBSCRIPTION_TABLE\)|from\("subscriptions"\)/);
      assert.match(src, /select\(SUBSCRIPTION_SELECT\)|status,\s*current_period_end/);
      assert.match(src, /eq\(\s*["']user_id["']/);
      assert.match(src, /maybeSingle\(\)/);
      assert.match(src, /auth\.getUser\(\)/);
      assert.match(src, /throwOnError/);
      assert.ok(!src.includes("SUPABASE_SERVICE_ROLE_KEY"), "DAL client nunca lê chave administrativa");
      assert.ok(!src.includes("createAdminClient"), "DAL client nunca usa client administrativo");
      assert.ok(!src.includes("service_role"), "DAL client nunca usa service_role");
    });

    test("RLS do banco restringe SELECT ao próprio usuário", () => {
      const migration = read("supabase/migrations/20260919190000_subscriptions.sql");
      assert.match(migration, /subscriptions_select_own/);
      assert.match(migration, /auth\.uid\(\)\)?\s*=\s*user_id/);
      assert.match(migration, /enable row level security/);
    });

    test("index da subscription exporta a DAL", () => {
      const src = read("src/lib/subscription/index.ts");
      assert.match(src, /from\s*["']\.\/queries["']/);
    });
  });

  describe("DAL funcional com client mockado", () => {
    test("fetchMySubscription retorna sessão + linha e filtra pelo próprio user_id", async () => {
      const createdAt = "2026-09-01T12:00:00.000Z";
      const futureEnd = new Date(NOW.getTime() + 30 * 86400000).toISOString();
      const client = mockClient({
        user: { id: USER_A, created_at: createdAt },
        subscriptionRow: { status: "active", current_period_end: futureEnd },
      });
      const result = await dal.fetchMySubscription(client);
      assert.equal(result.userId, USER_A);
      assert.equal(result.createdAt, createdAt);
      assert.deepEqual(result.subscription, { status: "active", current_period_end: futureEnd });
      assert.equal(client.__state.eqUserId, USER_A, "filtro user_id deve ser o usuário autenticado");
    });

    test("troca de estado: trial -> Pro -> expirado deriva via calculateTrial sem regressão", async () => {
      const createdAt = new Date(NOW.getTime() - 2 * 86400000).toISOString();
      // 1. Sem assinatura: trial vigente
      let client = mockClient({ user: { id: USER_A, created_at: createdAt }, subscriptionRow: null });
      let res = await dal.fetchMySubscription(client);
      let trial = calculateTrial(res.createdAt, res.subscription?.status, NOW, res.subscription?.current_period_end);
      assert.equal(trial.isTrialing, true);
      assert.equal(trial.isActive, false);
      assert.equal(canCreateShift(trial), true);

      // 2. Pós-pagamento: Pro ativa (refresh reativo)
      const futureEnd = new Date(NOW.getTime() + 30 * 86400000).toISOString();
      client = mockClient({
        user: { id: USER_A, created_at: createdAt },
        subscriptionRow: { status: "active", current_period_end: futureEnd },
      });
      res = await dal.fetchMySubscription(client);
      trial = calculateTrial(res.createdAt, res.subscription?.status, NOW, res.subscription?.current_period_end);
      assert.equal(trial.isActive, true);
      assert.equal(trial.proDaysRemaining, 30);
      assert.equal(canCreateShift(trial), true);

      // 3. Vigência expirada: bloqueia escrita, mantém leitura
      const pastEnd = new Date(NOW.getTime() - 86400000).toISOString();
      const oldCreated = new Date(NOW.getTime() - 60 * 86400000).toISOString();
      client = mockClient({
        user: { id: USER_A, created_at: oldCreated },
        subscriptionRow: { status: "active", current_period_end: pastEnd },
      });
      res = await dal.fetchMySubscription(client);
      trial = calculateTrial(res.createdAt, res.subscription?.status, NOW, res.subscription?.current_period_end);
      assert.equal(trial.isExpired, true);
      assert.equal(trial.isActive, false);
      assert.equal(canCreateShift(trial), false);
    });

    test("reconexão: canal Realtime usa filtro por usuário e nomes únicos por instância", async () => {
      const client = mockClient({ user: { id: USER_A, created_at: NOW.toISOString() }, subscriptionRow: null });
      let refreshCalls = 0;
      const ch1 = dal.createSubscriptionChannel(client, USER_A, () => refreshCalls++, "provider");
      assert.match(ch1.__name, new RegExp(`subscription-status:${USER_A}:provider`));
      assert.equal(ch1.__handlers[0].params.schema, "public");
      assert.equal(ch1.__handlers[0].params.table, "subscriptions");
      assert.equal(ch1.__handlers[0].params.filter, `user_id=eq.${USER_A}`);
      assert.equal(ch1.__handlers[0].type, "postgres_changes");

      // Evento realtime dispara refresh
      ch1.__handlers[0].cb({});
      assert.equal(refreshCalls, 1);

      // Segunda instância (ex.: TrialBadgeMobile) não colide
      const ch2 = dal.createSubscriptionChannel(client, USER_A, () => refreshCalls++, "r1-xyz");
      assert.notEqual(ch1.__name, ch2.__name);

      // Reconexão após queda: remove + recria e volta a receber eventos
      await dal.removeSubscriptionChannel(client, ch1);
      assert.equal(client.__state.removed, ch1);
      const ch3 = dal.createSubscriptionChannel(client, USER_A, () => refreshCalls++, "provider");
      ch3.__handlers[0].cb({});
      assert.equal(refreshCalls, 2);

      // Helpers determinísticos
      assert.equal(dal.subscriptionChannelName(USER_A), `subscription-status:${USER_A}:provider`);
      assert.equal(dal.subscriptionRealtimeFilter(USER_A), `user_id=eq.${USER_A}`);
    });

    test("sessão expirada: erro JWT propaga (throwOnError) em vez de vazar dados", async () => {
      const jwtError = new Error("invalid jwt expired");
      jwtError.code = "bad_jwt";
      const client = mockClient({ user: null, userError: jwtError });
      await assert.rejects(() => dal.fetchMySubscription(client), /invalid jwt|Sessão|Sessao|sessão|sessao|expired/i);

      const sessionClient = mockClient({ user: null, userError: jwtError });
      await assert.rejects(() => dal.getSubscriptionSession(sessionClient));
    });

    test("sem sessão: lança 'Usuário não autenticado.' e nunca consulta linha de terceiros", async () => {
      const client = mockClient({ user: null, subscriptionRow: { status: "active", current_period_end: null } });
      await assert.rejects(() => dal.fetchMySubscription(client), /Usuário não autenticado/);
      assert.equal(client.__state.eqUserId, null, "sem usuário, nenhuma query por user_id deve ocorrer");
    });

    test("isolamento entre usuários: cada usuário lê apenas a própria linha", async () => {
      const rows = new Map([
        [USER_A, { status: "active", current_period_end: new Date(NOW.getTime() + 10 * 86400000).toISOString() }],
        [USER_B, null],
      ]);
      const clientFor = (userId) =>
        mockClient({ user: { id: userId, created_at: NOW.toISOString() }, subscriptionRow: rows.get(userId) ?? null });

      const a = await dal.fetchMySubscription(clientFor(USER_A));
      const b = await dal.fetchMySubscription(clientFor(USER_B));
      assert.equal(a.subscription?.status, "active");
      assert.equal(b.subscription, null);
      assert.notDeepEqual(a.subscription, b.subscription);
    });

    test("erro de rede na linha propaga sem mascarar (provider decide fallback)", async () => {
      const client = mockClient({
        user: { id: USER_A, created_at: NOW.toISOString() },
        subscriptionRow: null,
        subscriptionError: new Error("network down"),
      });
      await assert.rejects(() => dal.getMySubscriptionRow(USER_A, client), /network down/);
    });
  });

  describe("paywall sem regressão (via DAL)", () => {
    test("trial vigente libera, expirado bloqueia, Pro libera", () => {
      const recent = new Date(NOW.getTime() - 2 * 86400000).toISOString();
      const old = new Date(NOW.getTime() - 60 * 86400000).toISOString();
      const futureEnd = new Date(NOW.getTime() + 60 * 86400000).toISOString();
      assert.equal(canCreateShift(calculateTrial(recent, null, NOW, null)), true);
      assert.equal(canCreateShift(calculateTrial(old, null, NOW, null)), false);
      assert.equal(canCreateShift(calculateTrial(old, "active", NOW, futureEnd)), true);
      assert.equal(canCreateShift(null), false);
    });

    test("loading/erro/trial/Pro preservados no contrato do provider", () => {
      const provider = read("src/lib/subscription/subscription-provider.tsx");
      assert.match(provider, /isLoading/);
      assert.match(provider, /setError/);
      assert.match(provider, /calculateTrial/);
      assert.match(provider, /refresh:\s*fetchSubscription/);
      assert.match(provider, /await refresh\(\)|void fetchSubscription/);
      const card = read("src/components/subscription/subscription-card.tsx");
      assert.match(card, /await refresh\(\)/);
    });
  });
});
