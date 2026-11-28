import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  addDaysIso,
  escapeHtml,
  formatBrl,
  getCalendarToday,
  isOverdueObligation,
  planEmailForUser,
  renderEmail,
} from "../src/lib/notifications/email-alerts.ts";
import { isCronAuthorized, isWellFormedUnsubscribeToken } from "../src/lib/notifications/cron-auth.ts";

// 2026-11-09 é segunda-feira. 15:00Z = 12:00 em America/Bahia (UTC-3).
const MONDAY = new Date("2026-11-09T15:00:00Z");
const TUESDAY = new Date("2026-11-10T15:00:00Z");
const OPTIONS = { siteUrl: "https://meuplantao.pro", unsubscribeUrl: "https://meuplantao.pro/descadastrar?token=abc" };

const ob = (id, saldo, data_prevista, place_name = "Hospital A") => ({ id, saldo, data_prevista, place_name });
const plan = (overrides) =>
  planEmailForUser({ now: TUESDAY, obligations: [], notifiedIds: [], lastDigestOn: null, ...overrides });

test("hoje no calendário de Bahia, inclusive na virada UTC", () => {
  assert.deepEqual(getCalendarToday(new Date("2026-11-09T02:30:00Z")), { iso: "2026-11-08", isMonday: false });
  assert.deepEqual(getCalendarToday(new Date("2026-11-10T02:30:00Z")), { iso: "2026-11-09", isMonday: true });
  assert.deepEqual(getCalendarToday(MONDAY), { iso: "2026-11-09", isMonday: true });
  assert.equal(addDaysIso("2026-11-28", 7), "2026-12-05");
});

test("atrasada: saldo > 0 e data_prevista < hoje; fronteira de hoje não é atraso", () => {
  assert.equal(isOverdueObligation({ saldo: 100, data_prevista: "2026-11-09" }, "2026-11-10"), true);
  assert.equal(isOverdueObligation({ saldo: 100, data_prevista: "2026-11-10" }, "2026-11-10"), false);
  assert.equal(isOverdueObligation({ saldo: 0, data_prevista: "2026-11-01" }, "2026-11-10"), false);
  assert.equal(isOverdueObligation({ saldo: null, data_prevista: "2026-11-01" }, "2026-11-10"), false);

  assert.equal(plan({ obligations: [ob("a", 100, "2026-11-10")] }), null, "vence hoje: sem aviso");
  const result = plan({ obligations: [ob("a", 100, "2026-11-09")] });
  assert.equal(result.kind, "overdue");
  assert.equal(result.newOverdue[0].daysLate, 1);
});

test("fuso: terça 02:30Z ainda é segunda em Bahia, então vence-segunda ainda não está atrasada", () => {
  const lateMonday = new Date("2026-11-10T02:30:00Z");
  assert.equal(planEmailForUser({ now: lateMonday, obligations: [ob("a", 50, "2026-11-09")], notifiedIds: [], lastDigestOn: "2026-11-09" }), null);
});

test("deduplicação: obrigação já notificada não gera novo aviso", () => {
  const obligations = [ob("a", 100, "2026-11-01"), ob("b", 200, "2026-11-02")];
  const result = plan({ obligations, notifiedIds: new Set(["a"]) });
  assert.deepEqual(result.newOverdue.map((i) => i.id), ["b"]);
  assert.equal(plan({ obligations, notifiedIds: ["a", "b"] }), null);
});

test("resumo semanal só às segundas, uma vez por dia, com saldo a receber", () => {
  const obligations = [ob("a", 100, "2026-11-12")];
  assert.equal(plan({ now: TUESDAY, obligations }), null, "terça não tem resumo");
  const monday = plan({ now: MONDAY, obligations });
  assert.equal(monday.kind, "digest");
  assert.equal(monday.summary.totalCents, 10000);
  assert.equal(monday.summary.upcomingCents, 10000);
  assert.equal(monday.summary.overdueCents, 0);
  assert.equal(plan({ now: MONDAY, obligations, lastDigestOn: "2026-11-09" }), null, "resumo de hoje já enviado");
  assert.equal(plan({ now: MONDAY, obligations, lastDigestOn: "2026-11-02" }).kind, "digest");
  assert.equal(plan({ now: MONDAY, obligations: [ob("z", 0, "2026-11-12")] }), null, "sem saldo, sem resumo");
});

test("resumo: janela de 7 dias inclui hoje+7 e exclui hoje+8", () => {
  const result = plan({ now: MONDAY, obligations: [ob("in", 10, "2026-11-16"), ob("out", 20, "2026-11-17")] });
  assert.equal(result.summary.upcomingCents, 1000);
  assert.equal(result.summary.totalCents, 3000);
});

test("e-mail único combinado: resumo carrega a seção de novos atrasos", () => {
  const obligations = [ob("late", 300.5, "2026-11-01"), ob("soon", 100, "2026-11-11")];
  const result = plan({ now: MONDAY, obligations });
  assert.equal(result.kind, "digest");
  assert.deepEqual(result.newOverdue.map((i) => i.id), ["late"]);
  assert.equal(result.summary.overdueCents, 30050);
  assert.equal(result.summary.totalCents, 40050);
  const email = renderEmail(result, OPTIONS);
  assert.match(email.text, /Novos atrasos/);
  assert.match(email.text, /R\$ 300,50/);
  // Segunda com resumo já enviado: só o aviso de atraso.
  const onlyOverdue = plan({ now: MONDAY, obligations, lastDigestOn: "2026-11-09" });
  assert.equal(onlyOverdue.kind, "overdue");
});

test("segunda-feira com atraso já notificado e resumo pendente: resumo sem seção de novos atrasos", () => {
  const result = plan({ now: MONDAY, obligations: [ob("late", 80, "2026-11-01")], notifiedIds: ["late"] });
  assert.equal(result.kind, "digest");
  assert.equal(result.newOverdue.length, 0);
  assert.doesNotMatch(renderEmail(result, OPTIONS).text, /Novos atrasos/);
});

test("escape de HTML em nomes de locais; texto simples sem quebra de linha injetada", () => {
  const evil = `<script>alert("x")</script> & "Cia'\nBcc: x@y.z`;
  const result = plan({ obligations: [ob("a", 10, "2026-11-01", evil)] });
  const email = renderEmail(result, OPTIONS);
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Cia&#39;"));
  assert.ok(!email.text.includes("\nBcc:"));
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("e-mail traz links de /alertas e descadastro, HTML e texto, sem promessa de recuperar dinheiro", () => {
  const email = renderEmail(plan({ obligations: [ob("a", 1234.5, "2026-11-01")] }), OPTIONS);
  for (const body of [email.html, email.text]) {
    assert.ok(body.includes("https://meuplantao.pro/alertas"));
    assert.ok(body.includes("https://meuplantao.pro/descadastrar?token=abc"));
    assert.doesNotMatch(body, /recuper|garant|resolve/i);
  }
  assert.match(email.text, /R\$ 1\.234,50/);
  assert.match(email.subject, /1 repasse/);
  assert.equal(formatBrl(5), "R$ 0,05");
});

test("lista longa é truncada e todas as novas atrasadas seguem no plano para serem gravadas", () => {
  const obligations = Array.from({ length: 12 }, (_, i) => ob(`o${i}`, 10, "2026-11-01"));
  const result = plan({ obligations });
  assert.equal(result.newOverdue.length, 12);
  assert.match(renderEmail(result, OPTIONS).text, /e mais 4/);
});

test("autenticação do cron é fail-closed e em tempo constante", () => {
  assert.equal(isCronAuthorized("Bearer segredo-123", "segredo-123"), true);
  assert.equal(isCronAuthorized("Bearer errado", "segredo-123"), false);
  assert.equal(isCronAuthorized("segredo-123", "segredo-123"), false, "exige prefixo Bearer");
  assert.equal(isCronAuthorized(null, "segredo-123"), false);
  assert.equal(isCronAuthorized("Bearer ", "segredo-123"), false);
  for (const secret of [undefined, null, "", "   "]) {
    assert.equal(isCronAuthorized("Bearer ", secret), false, "sem segredo configurado nunca autoriza");
    assert.equal(isCronAuthorized("Bearer undefined", secret), false);
  }
});

test("token de descadastro aceita só UUID", () => {
  assert.equal(isWellFormedUnsubscribeToken("3f1c2a52-9d6b-4c1e-8f3a-1b2c3d4e5f60"), true);
  for (const bad of ["", "abc", null, undefined, "3f1c2a52-9d6b-4c1e-8f3a-1b2c3d4e5f60'--", 42]) {
    assert.equal(isWellFormedUnsubscribeToken(bad), false);
  }
});

test("contrato das rotas: cron checa auth antes de tudo; GET de descadastro não existe; página noindex", () => {
  const cron = readFileSync(new URL("../src/app/api/cron/email-alerts/route.ts", import.meta.url), "utf8");
  assert.ok(cron.indexOf("isCronAuthorized") < cron.indexOf("RESEND_API_KEY"), "auth antes de qualquer outra leitura");
  assert.ok(cron.indexOf("isCronAuthorized") < cron.indexOf("createAdminClient()"), "auth antes do service role");
  assert.ok(cron.includes("MAX_SENDS_PER_RUN = 80"));
  assert.ok(cron.includes("List-Unsubscribe-Post"));
  assert.ok(cron.indexOf("await sendViaResend") < cron.indexOf("await recordSent"), "grava só depois do envio");

  const unsub = readFileSync(new URL("../src/app/api/email/unsubscribe/route.ts", import.meta.url), "utf8");
  assert.ok(!/export\s+async\s+function\s+GET/.test(unsub), "GET nunca altera nada");
  assert.match(unsub, /export\s+async\s+function\s+POST/);

  const page = readFileSync(new URL("../src/app/descadastrar/page.tsx", import.meta.url), "utf8");
  assert.match(page, /index:\s*false/);
  assert.match(page, /method="POST"/);

  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(vercel.crons, [{ path: "/api/cron/email-alerts", schedule: "0 11 * * *" }]);
  assert.ok(vercel.buildCommand);
});
