import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync("src/app/configuracoes/page.tsx", "utf8");

test("configuracoes exibe secao informativa sobre seguranca do webhook (MAI-113)", () => {
  assert.match(source, /Seguran\u00e7a dos pagamentos/);
  assert.match(source, /validadas automaticamente pelo servidor/);
  assert.match(source, /configura\u00e7\u00e3o de publica\u00e7\u00e3o/);
  assert.match(source, /nunca exibe nem solicita o segredo do webhook/);
  assert.match(source, /Nunca cole senhas, tokens ou c\u00f3digos secretos/);
  assert.match(source, /aria-labelledby="webhook-security-title"/);
  assert.match(source, /<ul/);
});

test("configuracoes nao le segredos nem expoe campo editavel de webhook", () => {
  assert.doesNotMatch(source, /MERCADO_PAGO_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /<input/);
  assert.doesNotMatch(source, /<textarea/);
  assert.doesNotMatch(source, /<select/);
  assert.doesNotMatch(source, /type="password"/);
});

test("configuracoes preserva comportamento existente de assinatura e preferencias", () => {
  assert.match(source, /SubscriptionCard/);
  assert.match(source, /ThemeToggle/);
});
