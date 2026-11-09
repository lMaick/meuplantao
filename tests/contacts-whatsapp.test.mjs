import assert from "node:assert/strict";
import test from "node:test";
import { buildChargeMessage, buildWhatsAppUrl, normalizeBrazilianPhone } from "../src/lib/contacts/whatsapp.ts";

test("telefone com máscara vira só dígitos com DDI 55", () => {
  assert.equal(normalizeBrazilianPhone("(71) 99999-8888"), "5571999998888");
  assert.equal(normalizeBrazilianPhone("71 9999-8888"), "557199998888");
  assert.equal(normalizeBrazilianPhone(" +55 (71) 99999-8888 "), "5571999998888");
});

test("aceita 13 e 12 dígitos já iniciados em 55 sem alterar", () => {
  assert.equal(normalizeBrazilianPhone("5571999998888"), "5571999998888");
  assert.equal(normalizeBrazilianPhone("557199998888"), "557199998888");
});

test("telefones inválidos retornam null", () => {
  assert.equal(normalizeBrazilianPhone(null), null);
  assert.equal(normalizeBrazilianPhone(""), null);
  assert.equal(normalizeBrazilianPhone("99999-888"), null);
  assert.equal(normalizeBrazilianPhone("719999988887"), null);
  assert.equal(normalizeBrazilianPhone("(71) 99999-88881"), null);
  assert.equal(normalizeBrazilianPhone("abc"), null);
  assert.equal(normalizeBrazilianPhone("1234567890123456"), null);
});

test("mensagem de cobrança segue o exemplo com data dd/mm e moeda pt-BR", () => {
  const message = buildChargeMessage({
    placeName: "Hospital X",
    shiftDate: "2026-10-12",
    balance: 1200,
    daysOverdue: 15,
  });
  assert.equal(
    message,
    "Olá! Tudo bem? Estou conferindo meus repasses e o plantão de 12/10 em Hospital X, no valor de R$ 1.200,00, consta em aberto há 15 dias. Consegue me dar uma previsão de pagamento? Obrigado!",
  );
});

test("mensagem trata um dia de atraso no singular", () => {
  const message = buildChargeMessage({ placeName: "UPA", shiftDate: "2026-11-01", balance: 350.5, daysOverdue: 1 });
  assert.match(message, /consta em aberto há 1 dia\./);
  assert.match(message, /R\$ 350,50/);
});

test("url do WhatsApp codifica acento e & na mensagem", () => {
  const message = "Plantão de 12/10 em Clínica São João & Filhos, valor pendente?";
  const url = buildWhatsAppUrl("5571999998888", message);
  assert.equal(
    url,
    "https://wa.me/5571999998888?text=Plant%C3%A3o%20de%2012%2F10%20em%20Cl%C3%ADnica%20S%C3%A3o%20Jo%C3%A3o%20%26%20Filhos%2C%20valor%20pendente%3F",
  );
  const decoded = new URL(url).searchParams.get("text");
  assert.equal(decoded, message);
});
