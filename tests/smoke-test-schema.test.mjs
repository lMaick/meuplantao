import assert from "node:assert/strict";
import test from "node:test";
import {
  redactSecrets,
  checkRpcViaRest,
  normalizeArgTypes,
  parsePsqlProcOutput,
  checkRpcsViaPsql,
  runSmokeTest,
  CRITICAL_RPCS,
  RPC_STATUS,
} from "../scripts/smoke-test-schema.mjs";
import { verifyProductionSchema } from "../scripts/verify-production-schema.mjs";

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
  
  assert.ok(map.has("save_shift_with_obligation"));
  assert.strictEqual(map.get("save_shift_with_obligation").expectedArgsCount, 11, "save_shift_with_obligation must expect 11 args (including idempotency_key)");

  assert.ok(map.has("register_payment"));
  assert.strictEqual(map.get("register_payment").expectedArgsCount, 3, "register_payment must expect 3 args");

  assert.ok(map.has("process_mercadopago_subscription_payment"));
  assert.strictEqual(map.get("process_mercadopago_subscription_payment").expectedArgsCount, 6, "process_mercadopago must expect 6 args");

  assert.ok(map.has("process_stripe_subscription_event"));
  assert.strictEqual(map.get("process_stripe_subscription_event").expectedArgsCount, 9, "process_stripe must expect 9 args");
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
  // 1. Current valid signatures (11, 3, 6, 9 args)
  const validPsqlOutput = `
save_shift_with_obligation|11|uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamp with time zone, boolean
  `;

  const validResults = parsePsqlProcOutput(validPsqlOutput);
  assert.strictEqual(validResults.save_shift_with_obligation.status, RPC_STATUS.FOUND);
  assert.strictEqual(validResults.save_shift_with_obligation.exists, true);
  assert.strictEqual(validResults.save_shift_with_obligation.argsCount, 11);

  assert.strictEqual(validResults.register_payment.status, RPC_STATUS.FOUND);
  assert.strictEqual(validResults.process_mercadopago_subscription_payment.status, RPC_STATUS.FOUND);
  assert.strictEqual(validResults.process_stripe_subscription_event.status, RPC_STATUS.FOUND);

  // 2. Outdated signature for save_shift_with_obligation with 10 arguments -> MUST BE MISSING / INCOMPATIBLE
  const outdatedPsqlOutput = `
save_shift_with_obligation|10|uuid, uuid, date, time without time zone, time without time zone, numeric, text, date, uuid, uuid
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamp with time zone, boolean
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
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamp with time zone, boolean
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
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamptz, boolean
  `;

  const outdatedCheck = checkRpcsViaPsql("postgresql://localhost:5432/postgres", { execFn: outdatedExec });
  assert.strictEqual(outdatedCheck.ok, true);
  assert.strictEqual(outdatedCheck.results.save_shift_with_obligation.status, RPC_STATUS.MISSING);
  assert.strictEqual(outdatedCheck.results.save_shift_with_obligation.exists, false);

  const validExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamptz, boolean
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
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamptz, boolean
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
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamptz, boolean
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
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamptz, boolean
  `;

  const psqlWrongTypeRes = await runSmokeTest({
    databaseUrl: "postgresql://localhost:5432/postgres",
    execPsqlFn: psqlWrongTypeExec,
    logger: mockLogger,
  });
  assert.strictEqual(psqlWrongTypeRes.ok, false, "Must fail closed if save_shift_with_obligation has 11 args but wrong types");
  assert.strictEqual(psqlWrongTypeRes.missingCount, 1);

  // 2. REST mode without SUPABASE_SERVICE_ROLE_KEY -> SKIPPED webhook RPCs -> MUST return ok: false in strict mode
  const fetchOk = async () => ({ status: 200, json: async () => ({}) });
  const anonOnlyRes = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    anonKey: "test-anon-key",
    // No serviceRoleKey provided -> process_mercadopago & process_stripe will be SKIPPED
    logger: mockLogger,
    fetchFn: fetchOk,
    usePsql: false,
  });
  assert.strictEqual(anonOnlyRes.ok, false, "Strict smoke test must fail when required webhook RPCs are SKIPPED");
  assert.strictEqual(anonOnlyRes.skippedCount, 2);

  // 3. PostgreSQL mode with full valid signatures -> MUST return ok: true
  const psqlValidExec = () => `
save_shift_with_obligation|11|uuid, uuid, date, time, time, numeric, text, date, uuid, uuid, text
register_payment|3|uuid, numeric, date
process_mercadopago_subscription_payment|6|text, uuid, integer, integer, numeric, text
process_stripe_subscription_event|9|text, text, uuid, text, text, text, text, timestamptz, boolean
  `;
  const psqlValidRes = await runSmokeTest({
    databaseUrl: "postgresql://localhost:5432/postgres",
    execPsqlFn: psqlValidExec,
    logger: mockLogger,
  });
  assert.strictEqual(psqlValidRes.ok, true);

  // 4. REST mode with service role key and all FOUND -> MUST return ok: true
  const allFoundRes = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "valid-service-role-key",
    logger: mockLogger,
    fetchFn: fetchOk,
    usePsql: false,
  });
  assert.strictEqual(allFoundRes.ok, true);
});

test("smoke-test-schema: verifyProductionSchema respects strict production gates and preview diagnostics", async () => {
  const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };
  const fetch200 = async () => ({ status: 200, json: async () => ({}) });
  const fetch404 = async () => ({ status: 404, json: async () => ({ code: "PGRST202" }) });

  // 1. Production with full valid configuration -> PASS
  const prodValidRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch200,
  });
  assert.strictEqual(prodValidRes.ok, true);
  assert.strictEqual(prodValidRes.strict, true);

  // 2. Production with missing SUPABASE_SERVICE_ROLE_KEY (causes SKIPPED RPCs) -> FAIL CLOSED (ok: false)
  const prodSkippedRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-only",
    },
    logger: mockLogger,
    fetchFn: fetch200,
  });
  assert.strictEqual(prodSkippedRes.ok, false, "Production gate must fail when service role key is missing and RPCs are skipped");
  assert.strictEqual(prodSkippedRes.strict, true);

  // 3. Production with missing RPC -> FAIL CLOSED (ok: false)
  const prodMissingRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch404,
  });
  assert.strictEqual(prodMissingRes.ok, false);
  assert.strictEqual(prodMissingRes.strict, true);

  // 4. Preview with missing RPC -> PASS with warning (does not block preview build)
  const previewWarnRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote-staging.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "valid-key-1234",
    },
    logger: mockLogger,
    fetchFn: fetch404,
  });
  assert.strictEqual(previewWarnRes.ok, true, "Preview build must NOT be blocked");
  assert.strictEqual(previewWarnRes.warned, true);
  assert.strictEqual(previewWarnRes.preview, true);

  // 5. Local development build without remote DB -> PASS (bypassed)
  const localRes = await verifyProductionSchema({
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" },
    logger: mockLogger,
  });
  assert.strictEqual(localRes.ok, true);
  assert.strictEqual(localRes.bypassed, true);
});
