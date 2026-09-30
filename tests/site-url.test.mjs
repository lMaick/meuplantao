import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const url = existsSync(new URL(`${base.href}.ts`)) ? `${base.href}.ts` : `${base.href}/index.ts`;
      return nextResolve(url, context);
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

import {
  DEFAULT_SITE_URL,
  getCanonicalOrigin,
  getClientOrigin,
  getSiteUrl,
  normalizeSiteUrl,
} from "../src/lib/config/site-url.ts";

const { getApplicationOrigin } = await import("../src/lib/mercadopago/config.ts");
const { getSiteUrl: getSeoSiteUrl } = await import("../src/lib/seo/site-url.ts");

const ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "VERCEL_ENV",
  "NODE_ENV",
];

function snapshotEnv() {
  const snap = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function clearSiteEnv() {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
}

test("MAI-139: produção com NEXT_PUBLIC_SITE_URL", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");
    assert.equal(getCanonicalOrigin("https://evil.example.com/checkout"), "https://meuplantao.pro");
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: fallback retrocompatível para NEXT_PUBLIC_APP_URL", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_APP_URL = "https://meuplantao.pro/";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");
    assert.equal(getSeoSiteUrl(), "https://meuplantao.pro");
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: SITE_URL preferencial sobre APP_URL com warn de divergência", () => {
  const snap = snapshotEnv();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.meuplantao.pro";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");
    assert.ok(warnings.some((w) => w.includes("divergem")));
  } finally {
    console.warn = originalWarn;
    restoreEnv(snap);
  }
});

test("MAI-139: fallback padrão em dev/teste e fail-closed em produção sem config", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    // Fora de produção: fallback padrão DEFAULT_SITE_URL
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    assert.equal(DEFAULT_SITE_URL, "https://meuplantao.pro");
    assert.equal(getSiteUrl(), "https://meuplantao.pro");

    // Em produção sem nenhuma configuração crítica: FAIL-CLOSED explícito
    process.env.NODE_ENV = "production";
    assert.throws(
      () => getSiteUrl(),
      /Configuração ausente: URL pública do MeuPlantão não configurada em ambiente de produção/,
    );
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: Vercel Preview via VERCEL_URL e PRODUCTION_URL", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.VERCEL_URL = "meuplantao-git-preview.vercel.app";
    assert.equal(getSiteUrl(), "https://meuplantao-git-preview.vercel.app");
    clearSiteEnv();
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "meuplantao.vercel.app";
    assert.equal(getSiteUrl(), "https://meuplantao.vercel.app");
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: trailing slashes múltiplos normalizados", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SITE_URL = "  https://meuplantao.pro///  ";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");
    assert.equal(normalizeSiteUrl("https://meuplantao.pro///"), "https://meuplantao.pro");
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: rejeição de URLs maliciosas/inválidas", () => {
  const snap = snapshotEnv();
  try {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL_ENV;
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "https://user:pass@meuplantao.pro",
      "https://@example.com",
      "https://meuplantao.pro/caminho?x=1",
      "https://meuplantao.pro/#frag",
      "https://meuplantao.pro/search?q=1",
      "not-a-url",
      "ftp://meuplantao.pro",
    ]) {
      assert.throws(() => normalizeSiteUrl(bad), /inválida|https/, `deveria rejeitar: ${bad}`);
    }
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    assert.throws(() => normalizeSiteUrl("http://meuplantao.pro"), /https/);
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: Host Header Injection bloqueado em produção (checkout/auth)", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    const evil = "https://evil-attacker.example.com/checkout?x=1";
    assert.equal(getCanonicalOrigin(evil), "https://meuplantao.pro");
    assert.equal(getApplicationOrigin(evil), "https://meuplantao.pro");
    // Sem config manual em produção: fail-closed imediato (não usa default silencioso)
    clearSiteEnv();
    assert.throws(
      () => getApplicationOrigin("https://evil.example.com/"),
      /Configuração ausente/,
    );
    assert.throws(
      () => getCanonicalOrigin("https://evil.example.com/"),
      /Configuração ausente/,
    );
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139 (auditoria): VERCEL_ENV=preview prioriza VERCEL_URL sobre PRODUCTION_URL", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "meuplantao.vercel.app";
    process.env.VERCEL_URL = "meuplantao-abc123-lmaick.vercel.app";
    assert.equal(getSiteUrl(), "https://meuplantao.vercel.app");
    process.env.VERCEL_ENV = "preview";
    assert.equal(getSiteUrl(), "https://meuplantao-abc123-lmaick.vercel.app");
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139 (auditoria): delimitadores vazios de @, ? e # são rejeitados", () => {
  const snap = snapshotEnv();
  try {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL_ENV;
    for (const bad of [
      "https://meuplantao.pro?",
      "https://meuplantao.pro#",
      "https://meuplantao.pro@",
      "https://meuplantao.pro/?",
      "https://meuplantao.pro/#",
    ]) {
      assert.throws(() => normalizeSiteUrl(bad), /canônica/, `deveria rejeitar: ${bad}`);
    }
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro?";
    assert.throws(() => getSiteUrl(), /canônica/);
  } finally {
    restoreEnv(snap);
  }
});
test("MAI-139: dev local permite localhost como fallback sem config", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    assert.equal(
      getCanonicalOrigin("http://localhost:3000/dashboard"),
      "http://localhost:3000",
    );
    // Com config manual, dev também prefere a canônica.
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";
    assert.equal(
      getCanonicalOrigin("http://localhost:3000/dashboard"),
      "https://meuplantao.pro",
    );
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: SEO e Mercado Pago usam a mesma fonte canônica", () => {
  const snap = snapshotEnv();
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro/";
    assert.equal(getSeoSiteUrl(), getSiteUrl());
    assert.equal(getApplicationOrigin("https://evil.example.com/"), getSiteUrl());
  } finally {
    restoreEnv(snap);
  }
});

test("MAI-139: getClientOrigin preserva preview no navegador e usa canonical no servidor", () => {
  const snap = snapshotEnv();
  const originalWindow = globalThis.window;
  try {
    clearSiteEnv();
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://meuplantao.pro";

    // 1. No servidor (sem window): usa canonical
    delete globalThis.window;
    assert.equal(getClientOrigin(), "https://meuplantao.pro");

    // 2. No navegador em preview: usa window.location.origin do preview
    globalThis.window = {
      location: {
        origin: "https://meuplantao-git-feat-preview.vercel.app",
      },
    };
    assert.equal(getClientOrigin(), "https://meuplantao-git-feat-preview.vercel.app");
  } finally {
    globalThis.window = originalWindow;
    restoreEnv(snap);
  }
});
