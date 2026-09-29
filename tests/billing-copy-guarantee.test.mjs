import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const CRITICAL_FILES = [
  "src/components/subscription/subscription-card.tsx",
  "src/components/subscription/paywall-modal.tsx",
  "src/components/landing/pricing-section.tsx",
  "src/components/landing/faq-section.tsx",
  "src/app/termos/page.tsx",
];

const FORBIDDEN_PATTERNS = [
  /cancele a qualquer momento/i,
  /1 clique/i,
  /garantia de 7 dias/i,
  /dinheiro de volta/i,
  /cancele quando quiser/i,
  /cancelamento imediato/i,
];

const REQUIRED_MODEL_PHRASES = [
  /sem renova[çc][aã]o autom[áa]tica/i,
  /sem cobran[çc]as recorrentes/i,
  /per[íi]odo fixo/i,
];

function readSources() {
  return CRITICAL_FILES.map((rel) => ({
    rel,
    content: fs.readFileSync(path.join(ROOT, rel), "utf8"),
  }));
}

describe("MAI-141: billing copy alinhada ao modelo pré-pago", () => {
  test("Nenhuma superfície crítica promete cancelamento 1-clique ou garantia de 7 dias", () => {
    for (const { rel, content } of readSources()) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        assert.ok(
          !pattern.test(content),
          `${rel} contém copy proibida (${pattern}): viola MAI-141`,
        );
      }
    }
  });

  test("Superfícies de plano/preço, FAQ e Termos descrevem o modelo pré-pago", () => {
    const targets = [
      "src/components/subscription/subscription-card.tsx",
      "src/components/subscription/paywall-modal.tsx",
      "src/components/landing/pricing-section.tsx",
      "src/components/landing/faq-section.tsx",
      "src/app/termos/page.tsx",
    ];
    for (const rel of targets) {
      const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const phrase of REQUIRED_MODEL_PHRASES) {
        assert.ok(
          phrase.test(content),
          `${rel} deve descrever o modelo pré-pago (${phrase})`,
        );
      }
    }
  });

  test("Checkout mantém menção a Mercado Pago sem prometer reembolso automático", () => {
    const card = fs.readFileSync(
      path.join(ROOT, "src/components/subscription/subscription-card.tsx"),
      "utf8",
    );
    assert.match(card, /Mercado Pago/i, "Deve manter identificação do meio de pagamento");
    assert.ok(!/reembolso/i.test(card), "Card não deve prometer reembolso não operacionalizado");
  });
});
