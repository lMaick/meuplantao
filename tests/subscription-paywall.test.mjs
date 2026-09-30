import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateTrial, canCreateShift } from "../src/lib/subscription/trial.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const NOW = new Date("2026-09-19T12:00:00.000Z");

describe("MAI-126: Paywall pos-trial + estado global reativo", () => {
  describe("bloqueio de criacao de plantoes (canCreateShift)", () => {
    test("trial vigente permite criar", () => {
      const trial = calculateTrial(NOW.toISOString(), null, NOW);
      assert.equal(trial.isExpired, false);
      assert.equal(canCreateShift(trial), true);
    });

    test("trial expirado sem Pro bloqueia criar/editar", () => {
      const created = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const trial = calculateTrial(created, null, NOW);
      assert.equal(trial.isExpired, true);
      assert.equal(trial.isActive, false);
      assert.equal(canCreateShift(trial), false);
    });

    test("Pro ativa com vigencia futura permite criar mesmo apos trial", () => {
      const created = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const trial = calculateTrial(created, "active", NOW, end);
      assert.equal(trial.isActive, true);
      assert.equal(canCreateShift(trial), true);
    });

    test("trial nulo nunca libera escrita (fail-closed)", () => {
      assert.equal(canCreateShift(null), false);
      assert.equal(canCreateShift(undefined), false);
    });
  });

  describe("PaywallModal: ergonomia clinica + motion", () => {
    test("componente existe com copy, CTA R$ 12,90 e modo leitura", () => {
      const src = read("src/components/subscription/paywall-modal.tsx");
      assert.match(src, /Trial expirado|período de teste/i);
      assert.match(src, /12,90/);
      assert.match(src, /Assinar MeuPlantão Pro/);
      assert.match(src, /modo leitura|Continuar em modo leitura/i);
      assert.match(src, /role="dialog"/);
      assert.match(src, /aria-modal="true"/);
    });

    test("motion principles + acessibilidade + touch 44px", () => {
      const src = read("src/components/subscription/paywall-modal.tsx");
      assert.match(src, /duration-200|duration-300/);
      assert.match(src, /backdrop-blur/);
      assert.match(src, /prefers-reduced-motion/);
      assert.match(src, /min-h-\[44px\]/);
      assert.match(src, /Escape/);
    });
  });

  describe("AppShell: provider global + interceptacao do Novo plantao", () => {
    test("AppShell envolve tudo no SubscriptionProvider", () => {
      const src = read("src/components/ui/app-shell.tsx");
      assert.match(src, /SubscriptionProvider/);
      assert.match(src, /from\s*["']@\/lib\/subscription["']/);
      assert.match(src, /<SubscriptionProvider>/);
      assert.match(src, /PaywallModal/);
    });

    test("botoes Novo plantao interceptam quando bloqueado + rota ?novo=1 abre paywall", () => {
      const src = read("src/components/ui/app-shell.tsx");
      assert.match(src, /canCreateShift/);
      assert.match(src, /handleNewShift/);
      assert.match(src, /novo/);
      assert.match(src, /setPaywallOpen\(true\)/);
    });

    test("TrialBadge e header consomem o estado global (sem fetch duplicado solto)", () => {
      const badge = read("src/components/subscription/trial-badge.tsx");
      assert.match(badge, /useSubscription/);
      const hook = read("src/lib/subscription/use-subscription.ts");
      assert.match(hook, /useSubscriptionContext/);
      const provider = read("src/lib/subscription/subscription-provider.tsx");
      const dal = read("src/lib/subscription/queries.ts");
      assert.match(provider, /createContext/);
      // MAI-143: realtime e filtro vivem na DAL; provider delega sem query inline.
      assert.ok(!provider.includes('.from("subscriptions")'), "provider não deve ter query inline (usar DAL)");
      assert.match(provider, /fetchMySubscription/);
      assert.match(provider, /createSubscriptionChannel/);
      assert.match(dal, /subscription-status/);
      assert.match(dal, /postgres_changes/);
      assert.match(dal, /user_id=eq\./);
      // Instância única no provider (sem useId por badge)
      assert.ok(!provider.includes("useId"), "provider deve ter canal único, sem useId por instância");
    });
  });

  describe("Card e badges exibem vigencia real", () => {
    test("SubscriptionCard mostra dias restantes + vencimento Pro", () => {
      const src = read("src/components/subscription/subscription-card.tsx");
      assert.match(src, /proDaysRemaining/);
      assert.match(src, /dias restantes/);
      assert.match(src, /até \$/);
      assert.match(src, /current_period_end|proEndsAt/);
    });

    test("TrialBadge desktop e mobile mostram vigencia Pro", () => {
      const src = read("src/components/subscription/trial-badge.tsx");
      assert.match(src, /proDaysRemaining/);
      assert.match(src, /dias restantes/);
      assert.match(src, /Plano Pro Ativo/);
    });

    test("sincronizar reflete via refresh do provider (sem F5)", () => {
      const card = read("src/components/subscription/subscription-card.tsx");
      assert.match(card, /await refresh\(\)/);
      const provider = read("src/lib/subscription/subscription-provider.tsx");
      assert.match(provider, /refresh: fetchSubscription/);
    });
  });
});
