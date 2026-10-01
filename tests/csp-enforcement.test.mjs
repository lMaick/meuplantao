import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCspEnforcingValue,
  buildCspReportOnlyValue,
  buildCspValue,
  CSP_ENFORCING_HEADER,
  CSP_REPORT_ENDPOINT,
  CSP_REPORT_ONLY_HEADER,
  getCspHeaders,
  shouldEnforceCsp,
} from "../src/lib/security/csp.ts";
import {
  checkCspReportRateLimit,
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_MAX_PER_WINDOW,
  getCspReportBodyByteLength,
  isAllowedCspContentType,
  isCspReportBodyTooLarge,
  resetCspReportRateLimitForTests,
  safeBlockedHost,
  safeDocumentPath,
  sanitizeCspReport,
} from "../src/lib/security/csp-report.ts";

function directiveValue(policy, name) {
  const match = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `) || part === name);
  assert.ok(match, `diretiva ausente: ${name}`);
  return match.slice(name.length).trim();
}

test("constantes de promoção: header efetivo e endpoint de relatório", () => {
  assert.equal(CSP_ENFORCING_HEADER, "Content-Security-Policy");
  assert.equal(CSP_REPORT_ONLY_HEADER, "Content-Security-Policy-Report-Only");
  assert.equal(CSP_REPORT_ENDPOINT, "/api/csp-report");
});

test("valores report-only e efetivo são idênticos após observação", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://xyzproject.supabase.co", NODE_ENV: "production" };
  assert.equal(buildCspEnforcingValue(env), buildCspReportOnlyValue(env));
  assert.equal(buildCspValue(env), buildCspReportOnlyValue(env));
});

test("política efetiva inclui report-uri same-origin sem wildcard", () => {
  const policy = buildCspEnforcingValue({ NODE_ENV: "production" });
  assert.equal(directiveValue(policy, "report-uri"), "/api/csp-report");
  assert.ok(!policy.split(/\s|;/).includes("*"), "wildcard proibido");
  assert.ok(!directiveValue(policy, "script-src").includes("unsafe-eval"), "produção sem unsafe-eval");
  assert.equal(directiveValue(policy, "form-action"), "'self'");
  assert.equal(directiveValue(policy, "frame-src"), "'self'");
  assert.ok(!policy.includes("mercadopago.com"), "nenhuma origem Mercado Pago");
});

test("shouldEnforceCsp: opt-in explícito, padrão report-only", () => {
  assert.equal(shouldEnforceCsp({}), false);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: undefined }), false);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: "" }), false);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: "false" }), false);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: "0" }), false);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: "true" }), true);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: "1" }), true);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: "TRUE" }), true);
  assert.equal(shouldEnforceCsp({ CSP_ENFORCE: " true " }), true);
});

test("getCspHeaders: sempre report-only; efetiva só sob flag, com mesmo valor", () => {
  const off = getCspHeaders({ NODE_ENV: "production" });
  assert.equal(off.length, 1);
  assert.equal(off[0].key, "Content-Security-Policy-Report-Only");

  const on = getCspHeaders({ NODE_ENV: "production", CSP_ENFORCE: "true" });
  assert.equal(on.length, 2);
  assert.equal(on[0].key, "Content-Security-Policy-Report-Only");
  assert.equal(on[1].key, "Content-Security-Policy");
  assert.equal(on[0].value, on[1].value);
});

test("next.config emite via getCspHeaders (fonte única, sem literal hardcoded)", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(source, /getCspHeaders/, "emissão gradual via helper");
  assert.ok(source.includes("src/lib/security/csp"), "fonte única preservada");
  const enforcing = source.match(/["']Content-Security-Policy["']/g) ?? [];
  assert.equal(enforcing.length, 0, "header efetivo só via constante + flag, nunca literal");
});

test("sanitizeCspReport aceita formato legado e remove query/fragment", () => {
  const res = sanitizeCspReport({
    "csp-report": {
      "violated-directive": "connect-src",
      "effective-directive": "connect-src",
      "blocked-uri": "https://evil.example.com/x?token=abc&next=1#frag",
      "document-uri": "https://meuplantao.pro/dashboard?session=xyz#top",
      "source-file": "https://meuplantao.pro/_next/static/chunk.js?h=1",
      "line-number": 10,
      "column-number": 5,
      "original-policy": "script-src 'self' 'nonce-SECRET456'; connect-src https://x.example.com/?token=SECRET789",
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.report.violatedDirective, "connect-src");
  assert.equal(res.report.blockedHost, "https://evil.example.com");
  assert.equal(res.report.documentPath, "/dashboard");
  assert.equal(res.report.sourcePath, "/_next/static/chunk.js");
  assert.equal(res.report.lineNumber, 10);
  assert.ok(!JSON.stringify(res.report).includes("token=abc"), "query nunca registrada");
  assert.ok(!JSON.stringify(res.report).includes("session=xyz"), "query nunca registrada");
});

test("sanitizeCspReport descarta original-policy (nonce/URL sensivel nunca logados)", () => {
  const res = sanitizeCspReport({
    "violated-directive": "script-src",
    "effective-directive": "script-src",
    "blocked-uri": "https://evil.example.com/x",
    "document-uri": "https://meuplantao.pro/login",
    "original-policy": "script-src 'self' 'nonce-SECRET456'; connect-src https://x.example.com/?token=SECRET789",
  });
  assert.equal(res.ok, true);
  assert.ok(!("originalPolicySnippet" in res.report), "campo nao deve existir no relatorio sanitizado");
  const dumped = JSON.stringify(res.report);
  assert.ok(!dumped.includes("SECRET456"), "nonce de original-policy nunca registrado");
  assert.ok(!dumped.includes("SECRET789"), "token de original-policy nunca registrado");
  assert.ok(!dumped.includes("original-policy"), "chave original-policy nunca registrada");
});

test("limite de corpo usa bytes reais UTF-8 (nao contagem de caracteres)", () => {
  assert.equal(isCspReportBodyTooLarge("x".repeat(100)), false);
  assert.equal(isCspReportBodyTooLarge("x".repeat(CSP_REPORT_MAX_BYTES + 1)), true);
  const multibyte = "é".repeat(5000);
  assert.ok(multibyte.length < CSP_REPORT_MAX_BYTES, "pre-condicao: 5000 caracteres");
  assert.equal(getCspReportBodyByteLength(multibyte), 10000);
  assert.equal(isCspReportBodyTooLarge(multibyte), true, "10000 bytes excedem o limite de 8192");
});

test("sanitizeCspReport mascara valores sensíveis e rejeita sem diretiva", () => {
  const sensitive = sanitizeCspReport({
    "violated-directive": "script-src",
    "blocked-uri": "https://x.example.com/?access_token=SECRET123",
    "document-uri": "https://meuplantao.pro/",
  });
  assert.equal(sensitive.ok, true);
  assert.ok(!JSON.stringify(sensitive.report).includes("SECRET123"));

  assert.deepEqual(sanitizeCspReport({ "blocked-uri": "https://x.example/" }).ok, false);
  assert.deepEqual(sanitizeCspReport(null).ok, false);
  assert.deepEqual(sanitizeCspReport("nao-objeto").ok, false);
});

test("safeBlockedHost/safeDocumentPath: esquemas especiais e self", () => {
  assert.equal(safeBlockedHost("self"), "self");
  assert.equal(safeBlockedHost("data:text/plain;base64,xx"), "data:");
  assert.equal(safeBlockedHost("blob:https://x/y"), "blob:");
  assert.equal(safeBlockedHost("inline"), "inline");
  assert.equal(safeBlockedHost(undefined), "unknown");
  assert.equal(safeDocumentPath("/dashboard?x=1#y"), "/dashboard");
  assert.equal(safeDocumentPath("https://meuplantao.pro/perfil?token=t"), "/perfil");
});

test("rate limit: permite a cota e bloqueia o excedente com Retry-After", () => {
  resetCspReportRateLimitForTests();
  const ip = `test-ip-${Date.now()}`;
  const now = Date.now();
  for (let i = 0; i < CSP_REPORT_MAX_PER_WINDOW; i += 1) {
    assert.equal(checkCspReportRateLimit(ip, now).allowed, true, `req ${i + 1} permitida`);
  }
  const blocked = checkCspReportRateLimit(ip, now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  resetCspReportRateLimitForTests();
});

test("content-type: aceita relatórios CSP e rejeita outros", () => {
  assert.equal(isAllowedCspContentType("application/csp-report"), true);
  assert.equal(isAllowedCspContentType("application/reports+json"), true);
  assert.equal(isAllowedCspContentType("application/json; charset=utf-8"), true);
  assert.equal(isAllowedCspContentType("text/plain"), false);
  assert.equal(isAllowedCspContentType(""), false);
  assert.equal(isAllowedCspContentType(undefined), false);
});

test("rota /api/csp-report: anti-abuso sem acesso a dados (contrato)", () => {
  const source = readFileSync(new URL("../src/app/api/csp-report/route.ts", import.meta.url), "utf8");
  for (const marker of ["sanitizeCspReport", "checkCspReportRateLimit", "429", "413", "415", "405", "Retry-After", "204", "csp_violation"]) {
    assert.ok(source.includes(marker), `rota deve conter: ${marker}`);
  }
  assert.ok(!source.includes("supabase"), "endpoint público não toca no banco (anti-abuso)");
  assert.ok(!source.includes("auth.getUser"), "endpoint público não exige nem consulta sessão");
});
