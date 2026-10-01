import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildHstsValue,
  DEFAULT_PRODUCTION_HSTS_HOSTS,
  getHstsValue,
  HSTS_HEADER,
  HSTS_INITIAL_MAX_AGE_SECONDS,
  isProductionHstsHost,
  normalizeHstsHostname,
  normalizeHstsProto,
  shouldSendHsts,
} from "../src/lib/security/hsts.ts";

test("constantes: header canônico e max-age inicial conservador", () => {
  assert.equal(HSTS_HEADER, "Strict-Transport-Security");
  assert.equal(HSTS_INITIAL_MAX_AGE_SECONDS, 86400);
  assert.deepEqual([...DEFAULT_PRODUCTION_HSTS_HOSTS], ["meuplantao.pro", "www.meuplantao.pro"]);
});

test("valor padrão é conservador: sem includeSubDomains nem preload", () => {
  assert.equal(getHstsValue(), "max-age=86400");
  assert.equal(buildHstsValue(), "max-age=86400");
  assert.ok(!getHstsValue().includes("includeSubDomains"), "subdomínios avaliados separadamente (MAI-146)");
  assert.ok(!getHstsValue().includes("preload"), "preload avaliado separadamente (MAI-146)");
});

test("buildHstsValue monta variantes explícitas e valida preload", () => {
  assert.equal(buildHstsValue({ maxAge: 604800 }), "max-age=604800");
  assert.equal(
    buildHstsValue({ maxAge: 31536000, includeSubDomains: true }),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(
    buildHstsValue({ maxAge: 31536000, includeSubDomains: true, preload: true }),
    "max-age=31536000; includeSubDomains; preload",
  );
  assert.throws(() => buildHstsValue({ maxAge: 0 }), /max-age inválido/);
  assert.throws(() => buildHstsValue({ maxAge: -1 }), /max-age inválido/);
  // Preload exige includeSubDomains + max-age longo (hstspreload.org).
  assert.throws(() => buildHstsValue({ preload: true }), /preload exige/);
  assert.throws(
    () => buildHstsValue({ maxAge: 86400, includeSubDomains: true, preload: true }),
    /preload exige/,
  );
});

test("normalização de hostname e protocolo", () => {
  assert.equal(normalizeHstsHostname("MEUPLANTAO.PRO:3000 "), "meuplantao.pro");
  assert.equal(normalizeHstsHostname("www.meuplantao.pro."), "www.meuplantao.pro");
  assert.equal(normalizeHstsHostname("[::1]:3000"), "[::1]");
  assert.equal(normalizeHstsHostname(null), "");
  assert.equal(normalizeHstsProto("https:"), "https");
  assert.equal(normalizeHstsProto(" HTTPS "), "https");
  assert.equal(normalizeHstsProto("http:"), "http");
});

test("somente apex + www de produção são hosts HSTS", () => {
  for (const host of ["meuplantao.pro", "www.meuplantao.pro", "MEUPLANTAO.PRO", "www.meuplantao.pro:443"]) {
    assert.equal(isProductionHstsHost(host), true, host);
  }
  for (const host of [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "[::1]",
    "meuplantao-git-preview.vercel.app",
    "meuplantao-abc123-lmaick.vercel.app",
    "staging.meuplantao.pro",
    "api.meuplantao.pro",
    "evil-meuplantao.pro",
    "meuplantao.pro.evil.com",
    "meuplantao.com",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isProductionHstsHost(host), false, String(host));
  }
});

test("shouldSendHsts: só produção via HTTPS; HTTP/localhost/preview nunca", () => {
  assert.equal(shouldSendHsts({ hostname: "meuplantao.pro", proto: "https" }), true);
  assert.equal(shouldSendHsts({ hostname: "meuplantao.pro", proto: "https:" }), true);
  assert.equal(shouldSendHsts({ hostname: "www.meuplantao.pro", proto: "https" }), true);
  // HTTP no host de produção: sem HSTS (redirect é papel da Vercel/edge).
  assert.equal(shouldSendHsts({ hostname: "meuplantao.pro", proto: "http" }), false);
  assert.equal(shouldSendHsts({ hostname: "www.meuplantao.pro", proto: "http:" }), false);
  // Localhost mesmo sobre HTTPS (túnel local): nunca força HSTS.
  assert.equal(shouldSendHsts({ hostname: "localhost", proto: "https" }), false);
  assert.equal(shouldSendHsts({ hostname: "localhost:3000", proto: "https" }), false);
  // Preview/staging/alternativos mesmo sobre HTTPS: nunca.
  assert.equal(
    shouldSendHsts({ hostname: "meuplantao-abc123.vercel.app", proto: "https" }),
    false,
  );
  assert.equal(shouldSendHsts({ hostname: "staging.meuplantao.pro", proto: "https" }), false);
  assert.equal(shouldSendHsts({ hostname: "evil.com", proto: "https" }), false);
  // Sem proto https explícito: fail-closed (não envia).
  assert.equal(shouldSendHsts({ hostname: "meuplantao.pro", proto: "" }), false);
  assert.equal(shouldSendHsts({ hostname: "meuplantao.pro" }), false);
});

test("middleware emite HSTS via fonte única e com gate por host/proto", () => {
  const source = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.ok(source.includes("src/lib/security/hsts") || source.includes("@/lib/security/hsts"), "middleware consome fonte única src/lib/security/hsts");
  assert.ok(source.includes("shouldSendHsts"), "middleware decide por host/proto");
  assert.ok(source.includes("HSTS_HEADER") || source.includes("Strict-Transport-Security"), "middleware define o header canônico");
  assert.ok(source.includes("getHstsValue"), "middleware usa o valor conservador");
  assert.ok(source.includes("x-forwarded-host") || source.includes("nextUrl.hostname"), "middleware lê o host da request");
  assert.ok(source.includes("x-forwarded-proto") || source.includes("nextUrl.protocol"), "middleware lê o protocolo (só HTTPS recebe HSTS)");
});

test("next.config NÃO emite HSTS estático (evita vazar para localhost/preview)", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  const hstsLiterals = source.match(/Strict-Transport-Security/g) ?? [];
  assert.equal(hstsLiterals.length, 0, "HSTS é host-condicional no middleware, nunca estático no build");
});
