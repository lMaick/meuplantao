import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const __testFilename = fileURLToPath(import.meta.url);
const __testDirname = path.dirname(__testFilename);
const trialModuleUrl = pathToFileURL(path.join(__testDirname, "..", "src", "lib", "subscription", "trial.ts")).href;
const configModuleUrl = pathToFileURL(path.join(__testDirname, "..", "src", "lib", "mercadopago", "config.ts")).href;

process.env.MERCADO_PAGO_ACCESS_TOKEN = "mp-token";

import {
  calculateTrial,
  calculateCumulativePeriodEnd,
  countProPayments,
  proDaysRemainingUntil,
  formatProVigencia,
  DAYS_PER_PRO_PAYMENT,
  MS_PER_DAY,
} from "../src/lib/subscription/trial.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/mercadopago/config") {
      return {
        url: configModuleUrl,
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/stripe/supabase") {
      return {
        url: "data:text/javascript,export const createAuthenticatedClient = () => globalThis.authenticatedClient; export const createAdminClient = () => globalThis.adminClient;",
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/subscription/trial") {
      return { url: trialModuleUrl, shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { POST: syncRoute } = await import("../src/app/api/mercadopago/sync/route.ts");
const { POST: webhookPost } = await import("../src/app/api/webhooks/mercadopago/route.ts");

const testUserId = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-09-19T12:00:00.000Z");

describe("MAI-126: Vigencia cumulativa automatica (PIX 30d por pagamento)", () => {
  test("1 pagamento aprovado = 30 dias a partir de agora", () => {
    const end = calculateCumulativePeriodEnd(
      [{ status: "approved", date_created: NOW.toISOString(), transaction_amount: 12.9 }],
      NOW,
    );
    assert.ok(end);
    const diffDays = Math.round((new Date(end).getTime() - NOW.getTime()) / MS_PER_DAY);
    assert.equal(diffDays, 30);
  });

  test("2 pagamentos aprovados via PIX = 60 dias cumulativos", () => {
    const end = calculateCumulativePeriodEnd(
      [
        { status: "approved", date_created: "2026-09-19T10:00:00.000Z", transaction_amount: 12.9 },
        { status: "approved", date_created: "2026-09-19T11:00:00.000Z", transaction_amount: 12.9 },
      ],
      NOW,
    );
    assert.ok(end);
    const diffDays = Math.round((new Date(end).getTime() - NOW.getTime()) / MS_PER_DAY);
    assert.equal(diffDays, 60);
  });

  test("pagamentos pendentes/recusados nao acumulam vigencia", () => {
    assert.equal(countProPayments([{ status: "pending" }, { status: "rejected" }]), 0);
    assert.equal(calculateCumulativePeriodEnd([{ status: "pending" }], NOW), null);
    assert.equal(calculateCumulativePeriodEnd([], NOW), null);
  });

  test("mesmos pagamentos geram o mesmo fim (idempotencia)", () => {
    const pool = [
      { status: "approved", date_created: NOW.toISOString(), transaction_amount: 12.9 },
      { status: "approved", date_created: NOW.toISOString(), transaction_amount: 12.9 },
    ];
    assert.equal(calculateCumulativePeriodEnd(pool, NOW), calculateCumulativePeriodEnd(pool, NOW));
  });

  test("calculateTrial deriva Pro ativa de current_period_end futuro", () => {
    const end = new Date(NOW.getTime() + 60 * MS_PER_DAY).toISOString();
    const trial = calculateTrial("2026-01-01T00:00:00.000Z", "expired", NOW, end);
    assert.equal(trial.status, "active");
    assert.equal(trial.isActive, true);
    assert.equal(trial.isExpired, false);
    assert.equal(trial.daysRemaining, 60);
    assert.equal(trial.proDaysRemaining, 60);
    assert.equal(trial.currentPeriodEnd, end);
    assert.equal(trial.proEndsAt, end);
    assert.equal(trial.trialEndsAt, end);
  });

  test("current_period_end expirado nao ativa o Pro", () => {
    const past = new Date(NOW.getTime() - 5 * MS_PER_DAY).toISOString();
    const trial = calculateTrial("2026-01-01T00:00:00.000Z", "active", NOW, past);
    assert.equal(trial.isActive, false);
    assert.equal(trial.isExpired, true);
    assert.equal(proDaysRemainingUntil(past, NOW), 0);
    assert.equal(formatProVigencia(past, NOW), null);
  });

  test("formatProVigencia exibe dias + data pt-BR", () => {
    const end = new Date(NOW.getTime() + 60 * MS_PER_DAY).toISOString();
    const label = formatProVigencia(end, NOW);
    assert.ok(label?.includes("60 dias restantes"));
    assert.ok(label?.includes("até"));
  });

  test("sync grava current_period_end cumulativo (2 pagamentos = 60d)", async () => {
    const upserts = [];
    globalThis.authenticatedClient = {
      auth: { getUser: async () => ({ data: { user: { id: testUserId } }, error: null }) },
    };
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: "2001", status: "approved", external_reference: testUserId, date_created: "2026-09-19T10:00:00.000Z", transaction_amount: 12.9 },
            { id: "2002", status: "approved", external_reference: testUserId, date_created: "2026-09-19T11:00:00.000Z", transaction_amount: 12.9 },
          ],
        }),
        { status: 200 },
      );
    globalThis.adminClient = {
      from: () => ({
        upsert: async (row, options) => {
          upserts.push({ row, options });
          return { error: null };
        },
      }),
    };

    const response = await syncRoute(new Request("http://localhost/api/mercadopago/sync", { method: "POST" }));
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.synced, true);
    assert.equal(json.status, "active");
    assert.ok(json.current_period_end, "sync deve retornar current_period_end");
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].row.user_id, testUserId);
    assert.equal(upserts[0].row.status, "active");
    assert.ok(upserts[0].row.current_period_end, "upsert deve gravar current_period_end");

    const days = Math.round((new Date(upserts[0].row.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(days >= 59 && days <= 61, `esperado ~60 dias, obtido ${days}`);
    assert.equal(DAYS_PER_PRO_PAYMENT, 30);
  });

  test("webhook acumula historico e grava current_period_end", async () => {
    globalThis.__mockWebhookSecret = null;
    const upserts = [];
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      // 1ª chamada: pagamento individual; 2ª: busca do histórico com 2 aprovados
      if (String(url).includes("/v1/payments/search")) {
        return new Response(
          JSON.stringify({
            results: [
              { status: "approved", date_created: "2026-09-19T10:00:00.000Z", transaction_amount: 12.9, external_reference: testUserId },
              { status: "approved", date_created: "2026-09-19T11:00:00.000Z", transaction_amount: 12.9, external_reference: testUserId },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ status: "approved", external_reference: testUserId, date_created: "2026-09-19T11:00:00.000Z", transaction_amount: 12.9 }),
        { status: 200 },
      );
    };
    globalThis.adminClient = {
      from: () => ({
        upsert: async (row, options) => {
          upserts.push({ row, options });
          return { error: null };
        },
      }),
    };

    const request = new Request("http://localhost/api/webhooks/mercadopago?data.id=999&type=payment", { method: "POST", body: JSON.stringify({ data: { id: "999" }, type: "payment" }) });
    const response = await webhookPost(request);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.received, true);
    assert.equal(json.processed, true);
    assert.ok(json.current_period_end);
    assert.equal(calls, 2, "webhook deve buscar pagamento + historico cumulativo");
    assert.ok(upserts[0].row.current_period_end);
    const days = Math.round((new Date(upserts[0].row.current_period_end).getTime() - Date.now()) / MS_PER_DAY);
    assert.ok(days >= 59 && days <= 61, `esperado ~60 dias, obtido ${days}`);
    globalThis.__mockWebhookSecret = null;
  });
});
