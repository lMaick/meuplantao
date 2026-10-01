import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCspReportOnlyValue,
  CSP_REPORT_ONLY_HEADER,
  getSentryIngestOrigin,
  getSupabaseConnectSources,
  getSupabaseCspOrigin,
} from "../src/lib/security/csp.ts";

const REQUIRED_DIRECTIVES = ["script-src", "style-src", "img-src", "connect-src", "frame-src", "font-src"];

function directiveValue(policy, name) {
  const match = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  assert.ok(match, `diretiva ausente: ${name}`);
  return match.slice(name.length).trim();
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("header usa o nome Report-Only (efetiva só sob flag MAI-145)", () => {
  assert.equal(CSP_REPORT_ONLY_HEADER, "Content-Security-Policy-Report-Only");
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(source, /CSP_REPORT_ONLY_HEADER|getCspHeaders/, "next.config deve emitir via constante de fonte única");
  assert.match(source, /buildCspReportOnlyValue|buildCspValue|getCspHeaders/, "next.config deve construir a política via helper");
  assert.ok(source.includes("src/lib/security/csp"), "fonte única: src/lib/security/csp");
  // Garante que não há emissão acidental da política efetiva (o nome Report-Only
  // contém o substring, então exige aspas + correspondência exata).
  const enforcing = source.match(/["']Content-Security-Policy["']/g) ?? [];
  assert.equal(enforcing.length, 0, "política efetiva só em follow-up após observação");
});

test("política contém as 6 diretivas críticas com valores explícitos e sem wildcard", () => {
  const policy = buildCspReportOnlyValue({
    NEXT_PUBLIC_SUPABASE_URL: "https://xyzproject.supabase.co",
    NODE_ENV: "production",
  });
  for (const directive of REQUIRED_DIRECTIVES) {
    const value = directiveValue(policy, directive);
    assert.ok(value.length > 0, `${directive} não pode ser vazia`);
  }
  assert.ok(!policy.split(/\s|;/).includes("*"), "wildcard desnecessário é proibido");
});

test("produção nunca usa unsafe-eval; desenvolvimento libera apenas para o HMR do Next", () => {
  const prod = buildCspReportOnlyValue({ NODE_ENV: "production" });
  assert.ok(!directiveValue(prod, "script-src").includes("unsafe-eval"), "produção sem unsafe-eval");
  const dev = buildCspReportOnlyValue({ NODE_ENV: "development" });
  assert.ok(directiveValue(dev, "script-src").includes("unsafe-eval"), "dev precisa de unsafe-eval p/ HMR");
});

test("script-src/style-src usam unsafe-inline de forma justificada (tema inline + runtime Next)", () => {
  const policy = buildCspReportOnlyValue({ NODE_ENV: "production" });
  const script = directiveValue(policy, "script-src");
  assert.ok(script.includes("'self'") && script.includes("'unsafe-inline'"));
  assert.ok(!script.includes("https://"), "nenhum host externo de script (sem SDK de terceiros no browser)");
  const style = directiveValue(policy, "style-src");
  assert.ok(style.includes("'self'") && style.includes("'unsafe-inline'"));
});

test("connect-src inclui Supabase (https + wss) somente quando configurado", () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://xyzproject.supabase.co" }, () => {
    assert.equal(getSupabaseCspOrigin(), "https://xyzproject.supabase.co");
    assert.deepEqual(getSupabaseConnectSources(), ["https://xyzproject.supabase.co", "wss://xyzproject.supabase.co"]);
    const connect = directiveValue(buildCspReportOnlyValue(), "connect-src");
    assert.ok(connect.includes("https://xyzproject.supabase.co"));
    assert.ok(connect.includes("wss://xyzproject.supabase.co"));
  });
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }, () => {
    assert.equal(getSupabaseCspOrigin(), null);
    assert.deepEqual(getSupabaseConnectSources(), []);
    const connect = directiveValue(buildCspReportOnlyValue(), "connect-src");
    assert.ok(!connect.includes("supabase.co"));
  });
});

test("connect-src inclui ingestão do Sentry somente quando DSN está configurado", () => {
  withEnv({ SENTRY_DSN: "https://abc123@o456.ingest.sentry.io/789", NEXT_PUBLIC_SENTRY_DSN: undefined }, () => {
    assert.equal(getSentryIngestOrigin(), "https://o456.ingest.sentry.io");
    const connect = directiveValue(buildCspReportOnlyValue(), "connect-src");
    assert.ok(connect.includes("https://o456.ingest.sentry.io"));
  });
  withEnv({ SENTRY_DSN: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined }, () => {
    assert.equal(getSentryIngestOrigin(), null);
    const connect = directiveValue(buildCspReportOnlyValue(), "connect-src");
    assert.ok(!connect.includes("sentry.io"));
  });
});

test("Mercado Pago usa navegacao top-level (window.location.href); form-action fica 'self'", () => {
  const policy = buildCspReportOnlyValue({ NODE_ENV: "production" });
  assert.equal(directiveValue(policy, "form-action"), "'self'");
  assert.ok(!policy.includes("mercadopago.com"), "nenhuma origem Mercado Pago na politica");
  assert.equal(directiveValue(policy, "frame-src"), "'self'");
});

test("headers existentes permanecem presentes com valores preservados", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  for (const [key, value] of [
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "SAMEORIGIN"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    ["X-Robots-Tag", "noindex, nofollow"],
  ]) {
    assert.ok(source.includes(`"${key}"`), `${key} preservado`);
    assert.ok(source.includes(`"${value}"`), `${key} com valor preservado`);
  }
});
