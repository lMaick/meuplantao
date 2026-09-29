import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("robots.ts permite indexação apenas de rotas públicas e bloqueia privadas", async () => {
  const robotsModule = await import("../src/app/robots.ts");
  const robotsFn = robotsModule.default;
  const config = robotsFn();

  assert.ok(config.rules, "deve conter regras de robots");
  const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;

  assert.equal(rules.userAgent, "*");

  const allowList = Array.isArray(rules.allow) ? rules.allow : [rules.allow];
  assert.ok(allowList.includes("/"), "deve permitir a landing page /");
  assert.ok(allowList.includes("/privacidade"), "deve permitir /privacidade");
  assert.ok(allowList.includes("/termos"), "deve permitir /termos");

  // Nenhuma rota privada deve estar na allowList
  for (const forbidden of ["/dashboard", "/login", "/cadastro", "/pagamentos", "/calendario", "/api"]) {
    assert.ok(!allowList.includes(forbidden), `rota privada ${forbidden} não pode estar no allow`);
  }

  const disallowList = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
  const requiredDisallows = [
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
    "/api/",
  ];

  for (const req of requiredDisallows) {
    const matched = disallowList.some((d) => d === req || d.startsWith(req));
    assert.ok(matched, `disallow deve cobrir ${req}`);
  }

  assert.ok(config.sitemap, "deve definir URL do sitemap");
  assert.ok(config.sitemap.endsWith("/sitemap.xml"), "sitemap deve apontar para /sitemap.xml");
});

test("sitemap.ts exporta apenas URLs públicas indexáveis com prioridades coerentes", async () => {
  const sitemapModule = await import("../src/app/sitemap.ts");
  const sitemapFn = sitemapModule.default;
  const entries = sitemapFn();

  assert.ok(Array.isArray(entries), "sitemap deve retornar um array");
  assert.equal(entries.length, 3, "sitemap deve conter exatamente as 3 rotas públicas");

  const urls = entries.map((e) => e.url);
  const homeEntry = entries.find((e) => !e.url.includes("/privacidade") && !e.url.includes("/termos"));
  assert.ok(homeEntry, "deve conter a home /");
  assert.equal(homeEntry.priority, 1.0, "home deve ter prioridade máxima 1.0");
  assert.equal(homeEntry.changeFrequency, "weekly");

  const privacidadeEntry = entries.find((e) => e.url.endsWith("/privacidade"));
  assert.ok(privacidadeEntry, "deve conter /privacidade");
  assert.equal(privacidadeEntry.priority, 0.5);

  const termosEntry = entries.find((e) => e.url.endsWith("/termos"));
  assert.ok(termosEntry, "deve conter /termos");
  assert.equal(termosEntry.priority, 0.5);

  // Proibir rotas privadas ou não indexáveis no sitemap
  for (const forbidden of ["cadastro", "login", "esqueci-senha", "redefinir-senha", "suporte", "dashboard", "calendario", "pagamentos"]) {
    assert.ok(!urls.some((u) => u.includes(`/${forbidden}`)), `sitemap não pode conter /${forbidden}`);
  }
});

test("next.config.ts não envia X-Robots-Tag global, mas protege rotas privadas", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

  // 1. Regra global /:path* não deve conter X-Robots-Tag
  // Localiza o bloco de source: "/:path*"
  const globalMatch = source.match(/source:\s*["']\/:path\*["'][\s\S]*?headers:\s*\[([\s\S]*?)\]/);
  assert.ok(globalMatch, "deve encontrar regra global /:path*");
  const globalHeadersContent = globalMatch[1];
  assert.ok(!globalHeadersContent.includes("X-Robots-Tag"), "regra global /:path* NÃO deve conter X-Robots-Tag");

  // Headers de segurança essenciais devem permanecer no global
  assert.ok(globalHeadersContent.includes("X-Content-Type-Options"));
  assert.ok(globalHeadersContent.includes("X-Frame-Options"));
  assert.ok(globalHeadersContent.includes("Referrer-Policy"));
  assert.ok(globalHeadersContent.includes("Permissions-Policy"));

  // 2. Rotas privadas devem estar listadas em privateNoIndexPaths
  const privatePrefixes = [
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
  ];

  for (const prefix of privatePrefixes) {
    assert.ok(source.includes(`"${prefix}"`), `privateNoIndexPaths deve incluir ${prefix}`);
  }

  // Confirma que X-Robots-Tag noindex, nofollow é aplicado nessas rotas privadas
  assert.ok(source.includes('"X-Robots-Tag"'));
  assert.ok(source.includes('"noindex, nofollow"'));
});

test("metadata das páginas públicas e privadas cumpre o mapa de SEO rigorosamente", () => {
  // layout.tsx: baseline noindex
  const layoutSrc = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layoutSrc, /metadataBase:\s*new URL\(/, "layout.tsx deve definir metadataBase");
  assert.match(layoutSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "layout raiz deve ter noindex defensivo");

  // page.tsx (landing): index, follow + canonical
  const pageSrc = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSrc, /robots:\s*\{[\s\S]*?index:\s*true[\s\S]*?follow:\s*true[\s\S]*?\}/, "home page deve ser index, follow");
  assert.match(pageSrc, /canonical:\s*["']\/["']/, "home page deve ter canonical /");

  // privacidade/page.tsx: index, follow + canonical
  const privSrc = readFileSync(new URL("../src/app/privacidade/page.tsx", import.meta.url), "utf8");
  assert.match(privSrc, /robots:\s*\{[\s\S]*?index:\s*true[\s\S]*?follow:\s*true[\s\S]*?\}/, "privacidade deve ser index, follow");
  assert.match(privSrc, /canonical:\s*["']\/privacidade["']/, "privacidade deve ter canonical /privacidade");

  // termos/page.tsx: index, follow + canonical
  const termSrc = readFileSync(new URL("../src/app/termos/page.tsx", import.meta.url), "utf8");
  assert.match(termSrc, /robots:\s*\{[\s\S]*?index:\s*true[\s\S]*?follow:\s*true[\s\S]*?\}/, "termos deve ser index, follow");
  assert.match(termSrc, /canonical:\s*["']\/termos["']/, "termos deve ter canonical /termos");

  // Páginas que devem ser noindex:
  const supSrc = readFileSync(new URL("../src/app/suporte/page.tsx", import.meta.url), "utf8");
  assert.match(supSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "suporte deve ser noindex");

  const loginSrc = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  assert.match(loginSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "login deve ser noindex");

  const cadSrc = readFileSync(new URL("../src/app/cadastro/page.tsx", import.meta.url), "utf8");
  assert.match(cadSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "cadastro deve ser noindex");

  const esqSrc = readFileSync(new URL("../src/app/esqueci-senha/layout.tsx", import.meta.url), "utf8");
  assert.match(esqSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "esqueci-senha deve ser noindex");

  const redSrc = readFileSync(new URL("../src/app/redefinir-senha/layout.tsx", import.meta.url), "utf8");
  assert.match(redSrc, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/, "redefinir-senha deve ser noindex");
});
