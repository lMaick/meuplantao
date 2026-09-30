import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

// MAI-139: hook de resolução .ts para o import aninhado
// src/lib/mercadopago/config.ts -> ../config/site-url
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (fs.existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { paymentBelongsToUser } = await import("../src/lib/mercadopago/config.ts");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("security: paymentBelongsToUser strictly verifies user ownership", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";

  // Valid ownership scenarios
  assert.equal(paymentBelongsToUser({ external_reference: userId }, userId), true);
  assert.equal(paymentBelongsToUser({ external_reference: `${userId}#1` }, userId), true);
  assert.equal(paymentBelongsToUser({ external_reference: `${userId}#3` }, userId), true);
  assert.equal(paymentBelongsToUser({ external_reference: `${userId}#6` }, userId), true);
  assert.equal(paymentBelongsToUser({ external_reference: `${userId}#12` }, userId), true);
  assert.equal(paymentBelongsToUser({ metadata: { user_id: userId } }, userId), true);
  assert.equal(paymentBelongsToUser({ metadata: { userId: userId } }, userId), true);

  // Adversarial / invalid scenarios that MUST return false
  assert.equal(paymentBelongsToUser({ external_reference: otherId }, userId), false);
  assert.equal(paymentBelongsToUser({ external_reference: `${otherId}#6` }, userId), false);
  assert.equal(paymentBelongsToUser({ external_reference: "" }, userId), false);
  assert.equal(paymentBelongsToUser({ external_reference: undefined }, userId), false);
  assert.equal(paymentBelongsToUser({ external_reference: null }, userId), false);
  assert.equal(paymentBelongsToUser({}, userId), false);
  assert.equal(paymentBelongsToUser({ metadata: { user_id: otherId } }, userId), false);
  assert.equal(paymentBelongsToUser({ metadata: {} }, userId), false);

  // Divergent identifiers between external_reference and metadata MUST return false
  assert.equal(paymentBelongsToUser({ external_reference: userId, metadata: { user_id: otherId } }, userId), false);
  assert.equal(paymentBelongsToUser({ external_reference: `${userId}#3`, metadata: { user_id: otherId } }, userId), false);
  assert.equal(paymentBelongsToUser({ external_reference: otherId, metadata: { user_id: userId } }, userId), false);
});

test("ui contract: AppShell desktop sidebar has overflow-y-auto to allow scrolling on small viewports", () => {
  const appShellSource = fs.readFileSync(path.join(ROOT, "src/components/ui/app-shell.tsx"), "utf8");
  assert.match(appShellSource, /aside className="[^"]*overflow-y-auto[^"]*"/, "Desktop sidebar must have overflow-y-auto");
  assert.match(appShellSource, /aside className="[^"]*overflow-x-hidden[^"]*"/, "Desktop sidebar must have overflow-x-hidden");
});

test("ui contract: TrialBadge is responsive and strictly truncated to prevent sidebar horizontal overflow", () => {
  const badgeSource = fs.readFileSync(path.join(ROOT, "src/components/subscription/trial-badge.tsx"), "utf8");
  assert.match(badgeSource, /w-full max-w-full/, "TrialBadge must use w-full max-w-full");
  assert.match(badgeSource, /truncate min-w-0/, "TrialBadge text must be truncated with min-w-0");
});

test("ui contract: SubscriptionCard allows active Pro users to select periods and extend/renew their plan", () => {
  const cardSource = fs.readFileSync(path.join(ROOT, "src/components/subscription/subscription-card.tsx"), "utf8");
  // PlanPeriodSelector should NOT be disabled when trial.isActive is true
  assert.doesNotMatch(cardSource, /disabled=\{isProcessing \|\| isSyncing \|\| \(trial\?\.isActive/);
  assert.match(cardSource, /Estender Plano Pro/);
  assert.match(cardSource, /Sincronizar pagamentos/);
});
