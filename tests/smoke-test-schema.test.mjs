import assert from "node:assert/strict";
import test from "node:test";
import {
  redactSecrets,
  checkRpcViaRest,
  normalizeArgTypes,
  parseProcRows,
  parsePsqlProcOutput,
  getPgClientConfig,
  checkRpcsViaPg,
  checkRpcsViaPsql,
  runSmokeTest,
  CRITICAL_RPCS,
  RPC_STATUS,
} from "../scripts/smoke-test-schema.mjs";
import { verifyProductionSchema } from "../scripts/verify-production-schema.mjs";
import { buildCompliantCatalogFixture } from "../scripts/check-rls-invariants.mjs";

// Mock read-only de catálogo íntegro para o estágio de segurança do gate.
// Sem isso, os testes de RPC válida falhariam no novo estágio de RLS/grants.
function compliantSecurityMocks() {
  const c = buildCompliantCatalogFixture();
  const rows = {
    tables: c.tables.map((t) => ({ tablename: t.tablename, rls_enabled: t.rls_enabled, force_rls: false })),
    tableGrants: c.tableGrants.map((g) => ({ tablename: g.tablename, grantee: g.grantee, privilege: g.privilege })),
    columnGrants: c.columnGrants,
    policies: c.policies,
    functions: c.functions.map((f) => ({
      name: f.name,
      args: f.args,
      secdef: f.secdef,
      owner: f.owner,
      exec_authenticated: f.exec_authenticated,
      exec_anon: f.exec_anon,
      exec_public: f.exec_public,
    })),
    effectiveTablePrivs: c.effectiveTablePrivs || [],
    effectiveColumnPrivs: c.effectiveColumnPrivs || [],
  };
  return {
    securityQueryFn: async (sql) => {
      if (sql.includes("has_table_privilege")) return { rows: rows.effectiveTablePrivs };
      if (sql.includes("has_column_privilege")) return { rows: rows.effectiveColumnPrivs };
      if (sql.includes("pg_class")) return { rows: rows.tables };
      if (sql.includes("role_column_grants")) return { rows: rows.columnGrants };
      if (sql.includes("role_table_grants")) return { rows: rows.tableGrants };
      if (sql.includes("pg_policies")) return { rows: rows.policies };
      if (sql.includes("pg_proc")) return { rows: rows.functions };
      throw new Error("unexpected catalog query");
    },
    securityClient: { query: async () => ({ rows: [] }), end: async () => {} },
  };
}

test("smoke-test-schema: normalizeArgTypes normalizes postgres aliases and parameter signatures", () => {
  const types1 = normalizeArgTypes("p_user_id uuid, p_start_time time without time zone, p_created_at timestamptz, p_count int4, p_flag bool DEFAULT false");
  assert.deepStrictEqual(types1, [
    "uuid",
    "time without time zone",
    "timestamp with time zone",
    "integer",
    "boolean",
  ]);

  const types2 = normalizeArgTypes(["time", "timestamptz", "int", "numeric", "varchar"]);
  assert.deepStrictEqual(types2, [
    "time without time zone",
    "timestamp with time zone",
    "integer",
    "numeric",
    "text",
  ]);
});

test("smoke-test-schema: CRITICAL_RPCS contract and expected argument counts", () => {
  const map = new Map(CRITICAL_RPCS.map((r) => [r.name, r]));
  
  assert.strictEqual(CRITICAL_RPCS.length, 4, "CRITICAL_RPCS must contain exactly 4 active RPCs");

  assert.ok(map.has("save_shift_with_obligation"));
  assert.strictEqual(map.get("save_shift_with_obligation").expectedArgsCount, 11, "save_shift_with_obligation must expect 11 args (including idempotency_key)");

  assert.ok(map.has("register_payment"));
  assert.strictEqual(map.get("register_payment").expectedArgsCount, 3, "register_payment must expect 3 args");

  assert.ok(map.has("process_mercadopago_subscription_payment"));
  assert.strictEqual(map.get("process_mercadopago_subscription_payment").expectedArgsCount, 6, "process_mercadopago must expect 6 args");

  assert.ok(map.has("reconcile_mercadopago_reversal"));
  assert.strictEqual(map.get("reconcile_mercadopago_reversal").expectedArgsCount, 6, "reconcile_mercadopago_reversal must expect 6 args");

  assert.strictEqual(
    map.has("process_stripe_subscription_event"),
    false,
    "process_stripe_subscription_event must be completely removed after Stripe decommissioning (PR #94, PR #104 / Issue #103)"
  );
});

test("smoke-test-schema: redactSecrets sanitizes all sensitive patterns", () => {
  const secretKey = "super-secret-service-role-key-12345";
  const rawDbUrl = "postgresql://postgres:mySecretPassword123@db.project.supabase.co:5432/postgres";
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignaturePart";

  // Redaction of explicit secret
  const log1 = `Failed to connect with key: ${secretKey}`;
  const redacted1 = redactSecrets(log1, [secretKey]);
  assert.strictEqual(redacted1.includes(secretKey), false);
  assert.strictEqual(redacted1.includes("[REDACTED]"), true);

  // Redaction of DB URL password
  const log2 = `Connecting to ${rawDbUrl}`;
  const redacted2 = redactSecrets(log2);
  assert.strictEqual(redacted2.includes("mySecretPassword123"), false);
  assert.strictEqual(redacted2.includes("postgres:[REDACTED]@"), true);

  // Redaction of JWT
  const log3 = `User token: ${jwt}`;
  const redacted3 = redactSecrets(log3);
  assert.strictEqual(redacted3.includes(jwt), false);
  assert.strictEqual(redacted3.includes("[REDACTED_JWT]"), true);

  // Redaction of Bearer and apikey
  const log4 = `Header apikey: xyz123456789012345 and Authorization: Bearer abc123456789012345`;
  const redacted4 = redactSecrets(log4);
  assert.strictEqual(redacted4.includes("xyz123456789012345"), false);
  assert.strictEqual(redacted4.includes("abc123456789012345"), false);
});

test("smoke-test-schema: parsePsqlProcOutput validates name AND exact signature args", () => {
  // 1. Current valid signatures (11, 3, 6 args)
  const validPsqlOutput = `
save_shift_with_obligation|11|uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
  `;

  const validResults = parsePsqlProcOutput(validPsqlOutput);
  assert.strictEqual(validResults.save_shift_with_obligation.status, RPC_STATUS.FOUND);
  assert.strictEqual(validResults.save_shift_with_obligation.exists, true);
  assert.strictEqual(validResults.save_shift_with_obligation.argsCount, 11);

  assert.strictEqual(validResults.register_payment.status, RPC_STATUS.FOUND);
  assert.strictEqual(validResults.process_mercadopago_subscription_payment.status, RPC_STATUS.FOUND);

  // 2. Outdated signature for save_shift_with_obligation with 10 arguments -> MUST BE MISSING / INCOMPATIBLE
  const outdatedPsqlOutput = `
save_shift_with_obligation|10|uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
  `;

  const outdatedResults = parsePsqlProcOutput(outdatedPsqlOutput);
  assert.strictEqual(outdatedResults.save_shift_with_obligation.status, RPC_STATUS.MISSING, "Outdated 10-arg signature must NOT be FOUND");
  assert.strictEqual(outdatedResults.save_shift_with_obligation.exists, false);
  assert.strictEqual(outdatedResults.save_shift_with_obligation.incompatible, true);
  assert.ok(outdatedResults.save_shift_with_obligation.details.includes("10"));

  // 3. Same name + same argument count (11 args) + WRONG types (last arg uuid instead of text) -> MUST NOT BE FOUND
  const wrongTypesPsqlOutput = `
save_shift_with_obligation|11|uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
  `;

  const wrongTypesResults = parsePsqlProcOutput(wrongTypesPsqlOutput);
  assert.strictEqual(wrongTypesResults.save_shift_with_obligation.status, RPC_STATUS.MISSING, "11-arg signature with wrong type (uuid instead of text) must NOT be FOUND");
  assert.strictEqual(wrongTypesResults.save_shift_with_obligation.exists, false);
  assert.strictEqual(wrongTypesResults.save_shift_with_obligation.incompatible, true);
  assert.ok(wrongTypesResults.save_shift_with_obligation.details.includes("Incompatible signature argument types"));

  // 4. Completely missing function
  const missingPsqlOutput = `
register_payment|3|uuid, numeric, date
  `;
  const missingResults = parsePsqlProcOutput(missingPsqlOutput);
  assert.strictEqual(missingResults.save_shift_with_obligation.status, RPC_STATUS.MISSING);
  assert.strictEqual(missingResults.save_shift_with_obligation.exists, false);
});

test("smoke-test-schema: checkRpcsViaPsql fails closed on outdated signature or missing RPCs", () => {
  const outdatedExec = () => `
save_shift_with_obligation|10|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
  `;

  const outdatedCheck = checkRpcsViaPsql("postgresql://localhost:5432/postgres", { execFn: outdatedExec });
  assert.strictEqual(outdatedCheck.ok, true);
  assert.strictEqual(outdatedCheck.results.save_shift_with_obligation.status, RPC_STATUS.MISSING);
  assert.strictEqual(outdatedCheck.results.save_shift_with_obligation.exists, false);

  const validExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
  `;

  const validCheck = checkRpcsViaPsql("postgresql://localhost:5432/postgres", { execFn: validExec });
  assert.strictEqual(validCheck.ok, true);
  assert.strictEqual(validCheck.results.save_shift_with_obligation.status, RPC_STATUS.FOUND);
  assert.strictEqual(validCheck.results.save_shift_with_obligation.exists, true);

  // Mismatched types (11 args, but last is uuid instead of text)
  const wrongTypeExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
  `;
  const wrongTypeCheck = checkRpcsViaPsql("postgresql://localhost:5432/postgres", { execFn: wrongTypeExec });
  assert.strictEqual(wrongTypeCheck.ok, true);
  assert.strictEqual(wrongTypeCheck.results.save_shift_with_obligation.status, RPC_STATUS.MISSING);
  assert.strictEqual(wrongTypeCheck.results.save_shift_with_obligation.exists, false);
});

test("smoke-test-schema: checkRpcViaRest strictly requires unequivocal evidence for FOUND", async () => {
  // 1. FOUND: HTTP 200 (direct response)
  const fetch200 = async () => ({ status: 200, json: async () => ({}) });
  const res200 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch200);
  assert.strictEqual(res200.status, RPC_STATUS.FOUND);
  assert.strictEqual(res200.exists, true);

  // 2. FOUND: HTTP 400 with unequivocal Postgres error code (e.g. 23514 check violation from inside RPC)
  const fetchPgError = async () => ({ status: 400, json: async () => ({ code: "23514", message: "Check constraint failed" }) });
  const resPgError = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetchPgError);
  assert.strictEqual(resPgError.status, RPC_STATUS.FOUND);
  assert.strictEqual(resPgError.exists, true);

  // 3. FAIL-CLOSED: Generic/ambiguous HTTP 400 without unequivocal Postgres code -> SERVER_ERROR (not FOUND)
  const fetchGeneric400 = async () => ({ status: 400, json: async () => ({ message: "Bad request syntax" }) });
  const resGeneric400 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetchGeneric400);
  assert.strictEqual(resGeneric400.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(resGeneric400.exists, false, "Generic 400 must NOT be treated as FOUND");

  // 4. MISSING: HTTP 404 with PGRST202
  const fetch404 = async () => ({ status: 404, json: async () => ({ code: "PGRST202", message: "Could not find function in schema cache" }) });
  const res404 = await checkRpcViaRest("https://test.supabase.co", "missing_fn", "key", fetch404);
  assert.strictEqual(res404.status, RPC_STATUS.MISSING);
  assert.strictEqual(res404.exists, false);

  // 5. AUTH_ERROR: HTTP 401 & 403
  const fetch401 = async () => ({ status: 401, json: async () => ({ message: "Invalid API key" }) });
  const res401 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "invalid_key", fetch401);
  assert.strictEqual(res401.status, RPC_STATUS.AUTH_ERROR);
  assert.strictEqual(res401.exists, false);

  const fetch403 = async () => ({ status: 403, json: async () => ({ message: "Permission denied" }) });
  const res403 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "anon_key", fetch403);
  assert.strictEqual(res403.status, RPC_STATUS.AUTH_ERROR);
  assert.strictEqual(res403.exists, false);

  // 6. SERVER_ERROR: HTTP 429 & 500
  const fetch429 = async () => ({ status: 429, json: async () => ({ message: "Too many requests" }) });
  const res429 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch429);
  assert.strictEqual(res429.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(res429.exists, false);

  const fetch500 = async () => ({ status: 500, json: async () => ({ message: "Internal Server Error" }) });
  const res500 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch500);
  assert.strictEqual(res500.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(res500.exists, false);

  // 7. NETWORK_ERROR: fetch network failure
  const fetchNetFail = async () => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND"); };
  const resNet = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetchNetFail);
  assert.strictEqual(resNet.status, RPC_STATUS.NETWORK_ERROR);
  assert.strictEqual(resNet.exists, false);
});

test("smoke-test-schema: runSmokeTest fails closed on outdated signature or SKIPPED RPCs in strict mode", async () => {
  const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };

  // 1. PostgreSQL mode with outdated 10-argument signature -> MUST return ok: false
  const psqlOutdatedExec = () => `
save_shift_with_obligation|10|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
reconcile_mercadopago_reversal|6|text, uuid, text, integer, integer, numeric
  `;

  const psqlOutdatedRes = await runSmokeTest({
    databaseUrl: "postgresql://localhost:5432/postgres",
    execPsqlFn: psqlOutdatedExec,
    logger: mockLogger,
  });
  assert.strictEqual(psqlOutdatedRes.ok, false, "Must fail closed if save_shift_with_obligation has only 10 args");
  assert.strictEqual(psqlOutdatedRes.missingCount, 1);

  // 1b. PostgreSQL mode with 11 arguments but incompatible types -> MUST return ok: false
  const psqlWrongTypeExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
reconcile_mercadopago_reversal|6|text, uuid, text, integer, integer, numeric
  `;

  const psqlWrongTypeRes = await runSmokeTest({
    databaseUrl: "postgresql://localhost:5432/postgres",
    execPsqlFn: psqlWrongTypeExec,
    logger: mockLogger,
  });
  assert.strictEqual(psqlWrongTypeRes.ok, false, "Must fail closed if save_shift_with_obligation has 11 args but wrong types");
  assert.strictEqual(psqlWrongTypeRes.missingCount, 1);

  // 2. REST mode (non-strict) without SUPABASE_SERVICE_ROLE_KEY -> SKIPPED webhook RPCs -> MUST return ok: false
  const fetchOk = async () => ({ status: 200, json: async () => ({}) });
  const anonOnlyRes = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    anonKey: "test-anon-key",
    // No serviceRoleKey provided -> process_mercadopago will be SKIPPED
    logger: mockLogger,
    fetchFn: fetchOk,
    usePsql: false,
    strict: false,
  });
  assert.strictEqual(anonOnlyRes.ok, false, "Smoke test must fail when required webhook RPCs are SKIPPED");
  assert.strictEqual(anonOnlyRes.skippedCount, 2);

  // 3. PostgreSQL mode with full valid signatures -> MUST return ok: true
  const psqlValidExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
reconcile_mercadopago_reversal|6|text, uuid, text, integer, integer, numeric
  `;
  const psqlValidRes = await runSmokeTest({
    databaseUrl: "postgresql://localhost:5432/postgres",
    execPsqlFn: psqlValidExec,
    logger: mockLogger,
    ...compliantSecurityMocks(),
  });
  assert.strictEqual(psqlValidRes.ok, true);

  // 4. REST mode (non-strict) with service role key and all FOUND -> MUST return ok: true
  const allFoundRes = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "valid-service-role-key",
    logger: mockLogger,
    fetchFn: fetchOk,
    usePsql: false,
    strict: false,
  });
  assert.strictEqual(allFoundRes.ok, true);

  // 5. Strict mode without DATABASE_URL -> MUST return ok: false
  const strictNoDbRes = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "valid-service-role-key",
    logger: mockLogger,
    fetchFn: fetchOk,
    strict: true,
  });
  assert.strictEqual(strictNoDbRes.ok, false);
  assert.strictEqual(strictNoDbRes.strict, true);

  // 6. Strict mode with DATABASE_URL, but psql throws -> MUST return ok: false without REST fallback
  let fetchCalledInStrictPsqlFail = false;
  const failingPsqlExec = () => { throw new Error("psql: connection refused"); };
  const strictPsqlFailRes = await runSmokeTest({
    databaseUrl: "postgresql://localhost:5432/postgres",
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "valid-service-role-key",
    execPsqlFn: failingPsqlExec,
    fetchFn: async () => {
      fetchCalledInStrictPsqlFail = true;
      return { status: 200, json: async () => ({}) };
    },
    logger: mockLogger,
    strict: true,
  });
  assert.strictEqual(strictPsqlFailRes.ok, false);
  assert.strictEqual(strictPsqlFailRes.strict, true);
  assert.strictEqual(fetchCalledInStrictPsqlFail, false, "Must NOT fall back to REST in strict mode when psql fails");
});

test("smoke-test-schema: verifyProductionSchema respects strict production gates and preview diagnostics", async () => {
  const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };
  const fetch200 = async () => ({ status: 200, json: async () => ({}) });
  const fetch404 = async () => ({ status: 404, json: async () => ({ code: "PGRST202" }) });
  const validPsqlExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
reconcile_mercadopago_reversal|6|text, uuid, text, integer, integer, numeric
  `;

  // 1. production + DATABASE_URL válido + assinaturas corretas -> ok:true
  const test1 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
    },
    logger: mockLogger,
    execPsqlFn: validPsqlExec,
    ...compliantSecurityMocks(),
  });
  assert.strictEqual(test1.ok, true, "1. production + DATABASE_URL válido + assinaturas corretas must be ok: true");
  assert.strictEqual(test1.strict, true);

  // 2. production sem DATABASE_URL, mesmo com REST retornando HTTP 200 -> ok:false
  const test2 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch200,
  });
  assert.strictEqual(test2.ok, false, "2. production sem DATABASE_URL, mesmo com REST 200 must be ok: false");
  assert.strictEqual(test2.strict, true);

  // 3. production com DATABASE_URL, mas psql falha -> ok:false, sem fallback REST
  let test3RestCalled = false;
  const failingPsql = () => { throw new Error("psql: connection refused"); };
  const test3 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@db.project.supabase.co:5432/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    execPsqlFn: failingPsql,
    fetchFn: async () => {
      test3RestCalled = true;
      return { status: 200, json: async () => ({}) };
    },
  });
  assert.strictEqual(test3.ok, false, "3. production com DATABASE_URL, mas psql falha must be ok: false");
  assert.strictEqual(test3.strict, true);
  assert.strictEqual(test3RestCalled, false, "3. Must NOT fall back to REST in production when psql fails");

  // 4. preview sem DATABASE_URL + REST funcionando -> continua não bloqueante
  const test4 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote-staging.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch200,
  });
  assert.strictEqual(test4.ok, true, "4. preview sem DATABASE_URL + REST funcionando must be ok: true");
  assert.strictEqual(test4.preview, true);

  // 5. CHECK_SCHEMA_COMPATIBILITY=1 sem DATABASE_URL -> ok:false
  const test5 = await verifyProductionSchema({
    env: {
      CHECK_SCHEMA_COMPATIBILITY: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch200,
  });
  assert.strictEqual(test5.ok, false, "5. CHECK_SCHEMA_COMPATIBILITY=1 sem DATABASE_URL must be ok: false");
  assert.strictEqual(test5.strict, true);

  // 6. Preview with missing RPC -> PASS with warning (does not block preview build)
  const previewWarnRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote-staging.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch404,
  });
  assert.strictEqual(previewWarnRes.ok, true, "Preview build must NOT be blocked on missing RPC");
  assert.strictEqual(previewWarnRes.warned, true);
  assert.strictEqual(previewWarnRes.preview, true);

  // 7. Local development build without remote DB -> PASS (bypassed)
  const localRes = await verifyProductionSchema({
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" },
    logger: mockLogger,
  });
  assert.strictEqual(localRes.ok, true);
  assert.strictEqual(localRes.bypassed, true);
});

test("smoke-test-schema: getPgClientConfig configures SSL and timeouts correctly", () => {
  const remoteConfig = getPgClientConfig("postgresql://postgres:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres");
  assert.strictEqual(remoteConfig.ssl.rejectUnauthorized, false);
  assert.strictEqual(remoteConfig.connectionTimeoutMillis, 10000);

  const localConfig = getPgClientConfig("postgresql://postgres:postgres@localhost:54322/postgres");
  assert.strictEqual(localConfig.ssl, undefined);
  assert.strictEqual(localConfig.connectionTimeoutMillis, 10000);
});

test("smoke-test-schema: node-postgres direct pg_proc verification (7 mandatory scenarios)", async () => {
  const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };

  const validRows = [
    {
      proname: "save_shift_with_obligation",
      pronargs: 11,
      argtypes: "uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, text",
    },
    {
      proname: "register_payment",
      pronargs: 3,
      argtypes: "uuid, numeric, date",
    },
    {
      proname: "process_mercadopago_subscription_payment",
      pronargs: 6,
      argtypes: "text, uuid, integer, integer, numeric, text",
    },
    {
      proname: "reconcile_mercadopago_reversal",
      pronargs: 6,
      argtypes: "text, uuid, text, integer, integer, numeric",
    },
  ];

  function createMockPgClient(rows = validRows, shouldThrow = false, errorMessage = "connect ECONNREFUSED") {
    return class MockPgClient {
      constructor(config) {
        this.config = config;
        this.connected = false;
        this.ended = false;
      }
      async connect() {
        if (shouldThrow) {
          throw new Error(errorMessage);
        }
        this.connected = true;
      }
      async query(sql, params) {
        if (shouldThrow) {
          throw new Error(errorMessage);
        }
        return { rows };
      }
      async end() {
        this.ended = true;
      }
    };
  }

  // Scenario 1: Strict + DB acessível + assinaturas corretas -> ok: true
  const MockValidClient = createMockPgClient(validRows);
  const scenario1 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: mockLogger,
    Client: MockValidClient,
    ...compliantSecurityMocks(),
  });
  assert.strictEqual(scenario1.ok, true, "Scenario 1: Strict + DB acessível + assinaturas corretas must be ok: true");
  assert.strictEqual(scenario1.strict, true);

  // Scenario 2: Strict + DB inacessível (ex: ECONNREFUSED) -> ok: false, sem fallback REST
  let scenario2RestCalled = false;
  const MockFailingClient = createMockPgClient([], true, "connect ECONNREFUSED ::1:5432");
  const scenario2 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-123",
    },
    logger: mockLogger,
    Client: MockFailingClient,
    fetchFn: async () => {
      scenario2RestCalled = true;
      return { status: 200, json: async () => ({}) };
    },
  });
  assert.strictEqual(scenario2.ok, false, "Scenario 2: Strict + DB inacessível must be ok: false");
  assert.strictEqual(scenario2.strict, true);
  assert.strictEqual(scenario2RestCalled, false, "Scenario 2: Must NOT fall back to REST in strict mode when DB connection fails");

  // Scenario 3: Strict + RPC ausente -> ok: false
  const missingRows = validRows.filter((r) => r.proname !== "save_shift_with_obligation");
  const MockMissingClient = createMockPgClient(missingRows);
  const scenario3 = await verifyProductionSchema({
    env: {
      CHECK_SCHEMA_COMPATIBILITY: "1",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: mockLogger,
    Client: MockMissingClient,
  });
  assert.strictEqual(scenario3.ok, false, "Scenario 3: Strict + RPC ausente must be ok: false");
  assert.strictEqual(scenario3.missingCount, 1);

  // Scenario 4: Strict + mesmo nome + mesma quantidade de argumentos + tipo errado -> ok: false
  const wrongTypeRows = validRows.map((r) => {
    if (r.proname === "save_shift_with_obligation") {
      return {
        ...r,
        argtypes: "uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, uuid", // last is uuid instead of text
      };
    }
    return r;
  });
  const MockWrongTypeClient = createMockPgClient(wrongTypeRows);
  const scenario4 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: mockLogger,
    Client: MockWrongTypeClient,
  });
  assert.strictEqual(scenario4.ok, false, "Scenario 4: Strict + mesmo nome + mesma quantidade + tipo errado must be ok: false");
  assert.strictEqual(scenario4.missingCount, 1);
  assert.strictEqual(scenario4.results.save_shift_with_obligation.incompatible, true);

  // Scenario 5: Strict + assinatura correta -> FOUND
  const pgDirectCheck = await checkRpcsViaPg("postgresql://localhost:5432/postgres", {
    Client: MockValidClient,
  });
  assert.strictEqual(pgDirectCheck.ok, true);
  assert.strictEqual(pgDirectCheck.results.save_shift_with_obligation.status, RPC_STATUS.FOUND, "Scenario 5: save_shift_with_obligation must be FOUND");
  assert.strictEqual(pgDirectCheck.results.register_payment.status, RPC_STATUS.FOUND);
  assert.strictEqual(pgDirectCheck.results.process_mercadopago_subscription_payment.status, RPC_STATUS.FOUND);
  assert.strictEqual(pgDirectCheck.results.reconcile_mercadopago_reversal.status, RPC_STATUS.FOUND);

  // Scenario 6: Confirmar que a execução não depende de psql instalado
  // When no execPsqlFn is passed, runSmokeTest uses node-postgres (checkRpcsViaPg) exclusively and does not spawn psql
  const scenario6 = await runSmokeTest({
    databaseUrl: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    logger: mockLogger,
    Client: MockValidClient,
    strict: true,
    ...compliantSecurityMocks(),
  });
  assert.strictEqual(scenario6.ok, true, "Scenario 6: Execution succeeds via node-postgres without psql");
  assert.strictEqual(scenario6.method, "pg", "Execution method must be 'pg' rather than 'psql'");

  // Scenario 7: Preview continua não-bloqueante
  const scenario7 = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://postgres:secret@pooler.supabase.com:5432/postgres",
    },
    logger: mockLogger,
    Client: MockMissingClient, // Missing RPC in preview should warn, not block
  });
  assert.strictEqual(scenario7.ok, true, "Scenario 7: Preview with missing RPC must NOT block build (ok: true)");
  assert.strictEqual(scenario7.warned, true);
  assert.strictEqual(scenario7.preview, true);
});

