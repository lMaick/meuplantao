import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

import { DEFAULT_SITE_URL, getSiteUrl } from "../src/lib/config/site-url.ts";

test("getSiteUrl normaliza URLs determinísticas com ou sem trailing slash", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  try {
    // 1. Sem variável definida: usa fallback canônico oficial
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(DEFAULT_SITE_URL, "https://meuplantao.pro");
    assert.equal(getSiteUrl(), "https://meuplantao.pro");

    // 2. Com URL sem trailing slash
    process.env.NEXT_PUBLIC_APP_URL = "https://meuplantao.pro";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");

    // 3. Com trailing slash simples
    process.env.NEXT_PUBLIC_APP_URL = "https://meuplantao.pro/";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");

    // 4. Com múltiplos trailing slashes e espaços
    process.env.NEXT_PUBLIC_APP_URL = "  https://meuplantao.pro///  ";
    assert.equal(getSiteUrl(), "https://meuplantao.pro");

    // 5. Domínio alternativo de staging
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.meuplantao.pro/";
    assert.equal(getSiteUrl(), "https://staging.meuplantao.pro");
  } finally {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  }
});

test("robots.txt permite indexação das páginas públicas e NÃO bloqueia HTML que depende de noindex", async () => {
  const robotsModule = await import("../src/app/robots.ts");
  const robotsFn = robotsModule.default;
  const config = robotsFn();

  assert.ok(config.rules, "deve conter regras de robots");
  const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;

  assert.equal(rules.userAgent, "*");

  const allowList = Array.isArray(rules.allow) ? rules.allow : [rules.allow];
  assert.ok(allowList.includes("/"), "deve permitir /");
  assert.ok(allowList.includes("/privacidade"), "deve permitir /privacidade");
  assert.ok(allowList.includes("/termos"), "deve permitir /termos");

  const disallowList = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];

  // /api/ e /auth/ DEVEM estar no Disallow
  assert.ok(disallowList.includes("/api/"), "deve bloquear /api/");
  assert.ok(disallowList.includes("/auth/"), "deve bloquear /auth/");

  // CRÍTICO (Estratégia SEO): páginas HTML que dependem de noindex NÃO devem
  // ser bloqueadas no robots.txt, para que os buscadores possam ler o noindex
  const htmlPagesWithNoIndex = [
    "/alertas",
    "/assinatura",
    "/cadastro",
    "/login",
    "/esqueci-senha",
    "/redefinir-senha",
    "/suporte",
    "/dashboard",
    "/calendario",
    "/pagamentos",
    "/historico",
    "/locais",
    "/contatos",
    "/perfil",
    "/configuracoes",
  ];

  for (const page of htmlPagesWithNoIndex) {
    const isDisallowed = disallowList.some((d) => d === page || d === `${page}/`);
    assert.ok(!isDisallowed, `página HTML ${page} NÃO pode estar no disallow do robots.txt`);
  }

  // Validação do sitemap URL
  assert.ok(config.sitemap, "deve definir URL do sitemap");
  assert.ok(config.sitemap.endsWith("/sitemap.xml"), "sitemap deve terminar com /sitemap.xml");
  assert.ok(!config.sitemap.includes("//sitemap.xml"), "sitemap não pode ter barra dupla no path");
});

test("sitemap.ts exporta exatamente as 3 URLs públicas sem barras duplas", async () => {
  const sitemapModule = await import("../src/app/sitemap.ts");
  const sitemapFn = sitemapModule.default;

  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  // Testa tanto sem barra quanto com barra no env
  for (const testBase of ["https://meuplantao.pro", "https://meuplantao.pro/"]) {
    process.env.NEXT_PUBLIC_APP_URL = testBase;

    const entries = sitemapFn();
    assert.equal(entries.length, 3, "sitemap deve conter exatamente 3 URLs públicas");

    const urls = entries.map((e) => e.url);

    // Nenhuma URL pode conter barra dupla no path
    for (const url of urls) {
      const pathPart = url.replace(/^https?:\/\/[^/]+/, "");
      assert.ok(!pathPart.includes("//"), `URL ${url} não pode conter barras duplas no path`);
    }

    assert.ok(urls.includes("https://meuplantao.pro"), "deve incluir a raiz");
    assert.ok(urls.includes("https://meuplantao.pro/privacidade"), "deve incluir /privacidade");
    assert.ok(urls.includes("https://meuplantao.pro/termos"), "deve incluir /termos");

    // Nenhuma rota privada no sitemap
    for (const forbidden of [
      "alertas",
      "assinatura",
      "cadastro",
      "login",
      "esqueci-senha",
      "redefinir-senha",
      "suporte",
      "dashboard",
      "calendario",
      "pagamentos",
    ]) {
      assert.ok(!urls.some((u) => u.includes(`/${forbidden}`)), `sitemap não pode conter /${forbidden}`);
    }
  }

  if (originalEnv !== undefined) {
    process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  } else {
    delete process.env.NEXT_PUBLIC_APP_URL;
  }
});

test("next.config.ts aplica X-Robots-Tag noindex em todas as rotas privadas, incluindo /alertas e /assinatura", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

  // 1. Regra global /:path* não pode conter X-Robots-Tag
  const globalMatch = source.match(/source:\s*["']\/:path\*["'][\s\S]*?headers:\s*\[([\s\S]*?)\]/);
  assert.ok(globalMatch, "deve encontrar regra global /:path*");
  const globalHeadersContent = globalMatch[1];
  assert.ok(!globalHeadersContent.includes("X-Robots-Tag"), "regra global /:path* NÃO deve conter X-Robots-Tag");

  // 2. Rotas privadas obrigatórias
  const privatePrefixes = [
    "/alertas",
    "/assinatura",
    "/cadastro",
    "/login",
    "/esqueci-senha",
    "/redefinir-senha",
    "/suporte",
    "/dashboard",
    "/calendario",
    "/pagamentos",
    "/historico",
    "/locais",
    "/contatos",
    "/perfil",
    "/configuracoes",
    "/api/:path*",
    "/auth/:path*",
  ];

  for (const prefix of privatePrefixes) {
    assert.ok(source.includes(`"${prefix}"`), `privateNoIndexPaths deve incluir ${prefix}`);
  }

  assert.ok(source.includes('"X-Robots-Tag"'));
  assert.ok(source.includes('"noindex, nofollow"'));
});

test("metadata das páginas HTML: somente /, /privacidade e /termos são indexáveis; todas as outras são noindex", () => {
  // Layout raiz: baseline noindex e getSiteUrl normalizado
  const layoutSrc = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layoutSrc, /metadataBase:\s*new URL\(getSiteUrl\(\)\)/, "layout.tsx deve usar getSiteUrl()");
  assert.match(layoutSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "layout raiz deve ter noindex defensivo");

  // 1. PÁGINAS INDEXÁVEIS:
  const pageSrc = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSrc, /robots:\s*\{[\s\S]*?index:\s*true[\s\S]*?follow:\s*true[\s\S]*?\}/, "home page deve ser index, follow");
  assert.match(pageSrc, /canonical:\s*["']\/["']/, "home page deve ter canonical /");

  const privSrc = readFileSync(new URL("../src/app/privacidade/page.tsx", import.meta.url), "utf8");
  assert.match(privSrc, /robots:\s*\{[\s\S]*?index:\s*true[\s\S]*?follow:\s*true[\s\S]*?\}/, "privacidade deve ser index, follow");
  assert.match(privSrc, /canonical:\s*["']\/privacidade["']/, "privacidade deve ter canonical /privacidade");

  const termSrc = readFileSync(new URL("../src/app/termos/page.tsx", import.meta.url), "utf8");
  assert.match(termSrc, /robots:\s*\{[\s\S]*?index:\s*true[\s\S]*?follow:\s*true[\s\S]*?\}/, "termos deve ser index, follow");
  assert.match(termSrc, /canonical:\s*["']\/termos["']/, "termos deve ter canonical /termos");

  // 2. PÁGINAS PRIVADAS (NOINDEX):
  const privatePages = [
    { file: "../src/app/alertas/page.tsx", name: "alertas" },
    { file: "../src/app/assinatura/page.tsx", name: "assinatura" },
    { file: "../src/app/suporte/page.tsx", name: "suporte" },
    { file: "../src/app/login/page.tsx", name: "login" },
    { file: "../src/app/cadastro/page.tsx", name: "cadastro" },
    { file: "../src/app/esqueci-senha/layout.tsx", name: "esqueci-senha" },
    { file: "../src/app/redefinir-senha/layout.tsx", name: "redefinir-senha" },
  ];

  for (const { file, name } of privatePages) {
    const content = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(
      content,
      /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/,
      `página ${name} (${file}) deve declarar robots: { index: false, follow: false }`
    );
  }
});
