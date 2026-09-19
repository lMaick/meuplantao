import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateTrial, TRIAL_DURATION_DAYS, MS_PER_DAY } from "../src/lib/subscription/trial.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("MAI-118: Subscription & 14-Day Trial System", () => {
  describe("1. Trial Calculation & State Derivation (calculateTrial)", () => {
    test("Calculates exact 14 days remaining for brand new registration", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdAt = "2026-09-19T12:00:00.000Z";

      const trial = calculateTrial(createdAt, null, now);
      assert.equal(trial.status, "trialing");
      assert.equal(trial.daysRemaining, 14);
      assert.equal(trial.isTrialing, true);
      assert.equal(trial.isExpired, false);
      assert.equal(trial.isActive, false);
      assert.equal(trial.totalDays, 14);
      assert.equal(
        trial.trialEndsAt,
        new Date(now.getTime() + 14 * MS_PER_DAY).toISOString()
      );
    });

    test("Calculates green tone range (14 to 4 days remaining)", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      // 5 days after creation -> 9 days remaining
      const created9d = new Date(now.getTime() - 5 * MS_PER_DAY).toISOString();
      const trial9d = calculateTrial(created9d, null, now);
      assert.equal(trial9d.status, "trialing");
      assert.equal(trial9d.daysRemaining, 9);
      assert.equal(trial9d.isTrialing, true);

      // 10 days after creation -> 4 days remaining
      const created4d = new Date(now.getTime() - 10 * MS_PER_DAY).toISOString();
      const trial4d = calculateTrial(created4d, null, now);
      assert.equal(trial4d.status, "trialing");
      assert.equal(trial4d.daysRemaining, 4);
      assert.equal(trial4d.isTrialing, true);
    });

    test("Calculates amber warning tone range (3 to 1 days remaining)", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");

      // 11.5 days after creation -> 3 days remaining (ceil)
      const created3d = new Date(now.getTime() - 11.5 * MS_PER_DAY).toISOString();
      const trial3d = calculateTrial(created3d, null, now);
      assert.equal(trial3d.status, "trialing");
      assert.equal(trial3d.daysRemaining, 3);
      assert.equal(trial3d.isTrialing, true);

      // 13 days after creation -> 1 day remaining
      const created1d = new Date(now.getTime() - 13.2 * MS_PER_DAY).toISOString();
      const trial1d = calculateTrial(created1d, null, now);
      assert.equal(trial1d.status, "trialing");
      assert.equal(trial1d.daysRemaining, 1);
      assert.equal(trial1d.isTrialing, true);
    });

    test("Transitions to 'expired' status once 14 days have passed", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");

      // Exactly 14 days ago
      const createdExact14 = new Date(now.getTime() - 14 * MS_PER_DAY).toISOString();
      const trialExact = calculateTrial(createdExact14, null, now);
      assert.equal(trialExact.status, "expired");
      assert.equal(trialExact.daysRemaining, 0);
      assert.equal(trialExact.isTrialing, false);
      assert.equal(trialExact.isExpired, true);
      assert.equal(trialExact.isActive, false);

      // 20 days ago (well past trial)
      const created20d = new Date(now.getTime() - 20 * MS_PER_DAY).toISOString();
      const trial20d = calculateTrial(created20d, null, now);
      assert.equal(trial20d.status, "expired");
      assert.equal(trial20d.daysRemaining, 0);
      assert.equal(trial20d.isTrialing, false);
      assert.equal(trial20d.isExpired, true);
    });

    test("Returns active subscriber state when subscriptionStatus is 'active' or 'pro'", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdPast = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();

      const activeTrial = calculateTrial(createdPast, "active", now);
      assert.equal(activeTrial.status, "active");
      assert.equal(activeTrial.isActive, true);
      assert.equal(activeTrial.isTrialing, false);
      assert.equal(activeTrial.isExpired, false);

      const proTrial = calculateTrial(createdPast, "pro", now);
      assert.equal(proTrial.status, "active");
      assert.equal(proTrial.isActive, true);
    });

    test("Gracefully handles missing, null, or invalid dates", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");

      const nullTrial = calculateTrial(null, null, now);
      assert.equal(nullTrial.status, "trialing");
      assert.equal(nullTrial.daysRemaining, 14);

      const invalidTrial = calculateTrial("invalid-date-string", null, now);
      assert.equal(invalidTrial.status, "trialing");
      assert.equal(invalidTrial.daysRemaining, 14);
    });
  });

  describe("2. AppShell Integration & Component Contracts", () => {
    test("AppShell imports and mounts TrialBadge and TrialBadgeMobile", () => {
      const appShellSource = fs.readFileSync(
        path.join(ROOT, "src/components/ui/app-shell.tsx"),
        "utf8"
      );

      assert.match(
        appShellSource,
        /import\s*\{[^}]*TrialBadge[^}]*\}\s*from\s*["']@\/components\/subscription["']/,
        "app-shell.tsx must import TrialBadge from subscription components"
      );
      assert.match(
        appShellSource,
        /<TrialBadge\s*\/>/,
        "app-shell.tsx desktop sidebar must render TrialBadge"
      );
      assert.match(
        appShellSource,
        /<TrialBadgeMobile\s*\/>/,
        "app-shell.tsx mobile top header must render TrialBadgeMobile"
      );
    });

    test("TrialBadge component contains required color tokens and copy", () => {
      const trialBadgeSource = fs.readFileSync(
        path.join(ROOT, "src/components/subscription/trial-badge.tsx"),
        "utf8"
      );

      // Emerald tone (14-4 days)
      assert.ok(
        trialBadgeSource.includes("bg-emerald-500/10"),
        "TrialBadge must include emerald background class"
      );
      // Amber tone (3-1 days)
      assert.ok(
        trialBadgeSource.includes("bg-amber-500/10"),
        "TrialBadge must include amber warning background class"
      );
      // Expired tone
      assert.ok(
        trialBadgeSource.includes("Trial expirado") ||
          trialBadgeSource.includes("Teste expirado"),
        "TrialBadge must include expired label copy"
      );
      // Skeleton loader for CLS prevention
      assert.ok(
        trialBadgeSource.includes("animate-pulse"),
        "TrialBadge must include loading skeleton to prevent CLS"
      );
    });
  });

  describe("3. Subscription Card & Settings Page Contracts", () => {
    test("SubscriptionCard displays R$ 12,90 price and clinical benefits", () => {
      const cardSource = fs.readFileSync(
        path.join(ROOT, "src/components/subscription/subscription-card.tsx"),
        "utf8"
      );

      // Price check
      assert.ok(cardSource.includes("12,90"), "Must display price 12,90");
      assert.ok(cardSource.includes("MeuPlantão Pro"), "Must display plan title MeuPlantão Pro");

      // Benefits checks
      assert.match(cardSource, /Controle ilimitado/i, "Must highlight unlimited shifts");
      assert.match(cardSource, /Alertas automáticos/i, "Must highlight automatic alerts");
      assert.match(cardSource, /Extratos detalhados|Conciliação/i, "Must highlight statements");
      assert.match(cardSource, /Sem fidelidade/i, "Must highlight no-lockin policy");

      // Action button
      assert.match(cardSource, /Assinar MeuPlantão Pro/i, "Must have subscription action button");
    });

    test("Settings page mounts SubscriptionCard", () => {
      const settingsSource = fs.readFileSync(
        path.join(ROOT, "src/app/configuracoes/page.tsx"),
        "utf8"
      );

      assert.match(
        settingsSource,
        /SubscriptionCard/,
        "src/app/configuracoes/page.tsx must render SubscriptionCard"
      );
    });

    test("Dedicated /assinatura page exists and renders SubscriptionCard", () => {
      const subscriptionPagePath = path.join(ROOT, "src/app/assinatura/page.tsx");
      assert.ok(fs.existsSync(subscriptionPagePath), "/assinatura page must exist");

      const pageSource = fs.readFileSync(subscriptionPagePath, "utf8");
      assert.match(pageSource, /SubscriptionCard/, "/assinatura must render SubscriptionCard");
    });
  });
});
