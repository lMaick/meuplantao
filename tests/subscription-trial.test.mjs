import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateTrial, TRIAL_DURATION_DAYS, MS_PER_DAY } from "../src/lib/subscription/trial.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("MAI-118: Subscription & 30-Day Trial System", () => {
  describe("1. Trial Calculation & State Derivation (calculateTrial)", () => {
    test("Calculates exact 30 days remaining for brand new registration", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdAt = "2026-09-19T12:00:00.000Z";

      const trial = calculateTrial(createdAt, null, now);
      assert.equal(trial.status, "trialing");
      assert.equal(trial.daysRemaining, TRIAL_DURATION_DAYS);
      assert.equal(trial.isTrialing, true);
      assert.equal(trial.isExpired, false);
      assert.equal(trial.isActive, false);
      assert.equal(trial.totalDays, TRIAL_DURATION_DAYS);
      assert.equal(
        trial.trialEndsAt,
        new Date(now.getTime() + TRIAL_DURATION_DAYS * MS_PER_DAY).toISOString()
      );
    });

    test("Calculates green tone range (30 to 4 days remaining)", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      // 5 days after creation -> 25 days remaining
      const created25d = new Date(now.getTime() - 5 * MS_PER_DAY).toISOString();
      const trial25d = calculateTrial(created25d, null, now);
      assert.equal(trial25d.status, "trialing");
      assert.equal(trial25d.daysRemaining, 25);
      assert.equal(trial25d.isTrialing, true);

      // 26 days after creation -> 4 days remaining
      const created4d = new Date(now.getTime() - 26 * MS_PER_DAY).toISOString();
      const trial4d = calculateTrial(created4d, null, now);
      assert.equal(trial4d.status, "trialing");
      assert.equal(trial4d.daysRemaining, 4);
      assert.equal(trial4d.isTrialing, true);
    });

    test("Calculates amber warning tone range (3 to 1 days remaining)", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");

      // 27.5 days after creation -> 3 days remaining (ceil)
      const created3d = new Date(now.getTime() - 27.5 * MS_PER_DAY).toISOString();
      const trial3d = calculateTrial(created3d, null, now);
      assert.equal(trial3d.status, "trialing");
      assert.equal(trial3d.daysRemaining, 3);
      assert.equal(trial3d.isTrialing, true);

      // 29.2 days after creation -> 1 day remaining
      const created1d = new Date(now.getTime() - 29.2 * MS_PER_DAY).toISOString();
      const trial1d = calculateTrial(created1d, null, now);
      assert.equal(trial1d.status, "trialing");
      assert.equal(trial1d.daysRemaining, 1);
      assert.equal(trial1d.isTrialing, true);
    });

    test("Transitions to 'expired' status once 30 days have passed", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");

      // Exactly 30 days ago
      const createdExact30 = new Date(now.getTime() - TRIAL_DURATION_DAYS * MS_PER_DAY).toISOString();
      const trialExact = calculateTrial(createdExact30, null, now);
      assert.equal(trialExact.status, "expired");
      assert.equal(trialExact.daysRemaining, 0);
      assert.equal(trialExact.isTrialing, false);
      assert.equal(trialExact.isExpired, true);
      assert.equal(trialExact.isActive, false);

      // 40 days ago (well past trial)
      const created40d = new Date(now.getTime() - 40 * MS_PER_DAY).toISOString();
      const trial40d = calculateTrial(created40d, null, now);
      assert.equal(trial40d.status, "expired");
      assert.equal(trial40d.daysRemaining, 0);
      assert.equal(trial40d.isTrialing, false);
      assert.equal(trial40d.isExpired, true);
    });

    test("Cenário A: status='active' com current_period_end=null NÃO inventa Pro de 30 dias", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdPast = new Date(now.getTime() - 40 * MS_PER_DAY).toISOString();
      const createdRecent = new Date(now.getTime() - 2 * MS_PER_DAY).toISOString();

      // Conta antiga (> 30 dias) sem vigência real cai para expirada, nunca Pro ativa
      const trialOld = calculateTrial(createdPast, "active", now, null);
      assert.equal(trialOld.status, "expired");
      assert.equal(trialOld.isActive, false);
      assert.equal(trialOld.isExpired, true);
      assert.equal(trialOld.isTrialing, false);
      assert.equal(trialOld.daysRemaining, 0);
      assert.equal(trialOld.proDaysRemaining, 0);
      assert.equal(trialOld.proEndsAt, null);

      // Conta recente (< 30 dias) sem vigência real fica no trial natural, nunca Pro ativa
      const trialNew = calculateTrial(createdRecent, "active", now, null);
      assert.equal(trialNew.status, "trialing");
      assert.equal(trialNew.isActive, false);
      assert.equal(trialNew.isExpired, false);
      assert.equal(trialNew.isTrialing, true);
      assert.equal(trialNew.daysRemaining, TRIAL_DURATION_DAYS - 2);
      assert.equal(trialNew.proDaysRemaining, 0);
      assert.equal(trialNew.proEndsAt, null);
    });

    test("Cenário B: status='active' com current_period_end futuro deriva Pro ativo", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdPast = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
      const futureEnd = new Date(now.getTime() + 30 * MS_PER_DAY).toISOString();

      const trial = calculateTrial(createdPast, "active", now, futureEnd);
      assert.equal(trial.status, "active");
      assert.equal(trial.isActive, true);
      assert.equal(trial.isExpired, false);
      assert.equal(trial.isTrialing, false);
      assert.equal(trial.daysRemaining, 30);
      assert.equal(trial.proDaysRemaining, 30);
      assert.equal(trial.currentPeriodEnd, futureEnd);
      assert.equal(trial.proEndsAt, futureEnd);
    });

    test("Cenário C: status='active' com current_period_end passado deriva Pro expirado", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdPast = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
      const pastEnd = new Date(now.getTime() - 5 * MS_PER_DAY).toISOString();

      const trial = calculateTrial(createdPast, "active", now, pastEnd);
      assert.equal(trial.status, "expired");
      assert.equal(trial.isActive, false);
      assert.equal(trial.isExpired, true);
      assert.equal(trial.isTrialing, false);
      assert.equal(trial.daysRemaining, 0);
      assert.equal(trial.proDaysRemaining, 0);
      assert.equal(trial.proEndsAt, null);
      assert.equal(trial.currentPeriodEnd, pastEnd);
    });

    test("Cenário D: usuário sem assinatura segue período de trial normal da conta", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");
      const createdRecent = new Date(now.getTime() - 4 * MS_PER_DAY).toISOString();
      const createdPast = new Date(now.getTime() - 40 * MS_PER_DAY).toISOString();

      // Conta criada há 4 dias -> 26 dias restantes de trial
      const trialRecent = calculateTrial(createdRecent, null, now, null);
      assert.equal(trialRecent.status, "trialing");
      assert.equal(trialRecent.isActive, false);
      assert.equal(trialRecent.isTrialing, true);
      assert.equal(trialRecent.isExpired, false);
      assert.equal(trialRecent.daysRemaining, TRIAL_DURATION_DAYS - 4);
      assert.equal(trialRecent.proDaysRemaining, 0);

      // Conta criada há 40 dias -> trial expirado
      const trialPast = calculateTrial(createdPast, null, now, null);
      assert.equal(trialPast.status, "expired");
      assert.equal(trialPast.isActive, false);
      assert.equal(trialPast.isTrialing, false);
      assert.equal(trialPast.isExpired, true);
      assert.equal(trialPast.daysRemaining, 0);
      assert.equal(trialPast.proDaysRemaining, 0);
    });

    test("Gracefully handles missing, null, or invalid dates", () => {
      const now = new Date("2026-09-19T12:00:00.000Z");

      const nullTrial = calculateTrial(null, null, now);
      assert.equal(nullTrial.status, "trialing");
      assert.equal(nullTrial.daysRemaining, TRIAL_DURATION_DAYS);

      const invalidTrial = calculateTrial("invalid-date-string", null, now);
      assert.equal(invalidTrial.status, "trialing");
      assert.equal(invalidTrial.daysRemaining, TRIAL_DURATION_DAYS);
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

      // Emerald tone (30-4 days)
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
      assert.match(cardSource, /Compra pré-paga|período fixo/i, "Must describe prepaid fixed-period model");

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
