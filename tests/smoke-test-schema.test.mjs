import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets, checkRpcViaRest, runSmokeTest, CRITICAL_RPCS, RPC_STATUS } from "../scripts/smoke-test-schema.mjs";
import { verifyProductionSchema } from "../scripts/verify-production-schema.mjs";

test("smoke-test-schema: CRITICAL_RPCS list contract", () => {
  const names = CRITICAL_RPCS.map((r) => r.name);
  assert.ok(names.includes("save_shift_with_obligation"), "Must include save_shift_with_obligation");
  assert.ok(names.includes("register_payment"), "Must include register_payment");
  assert.ok(names.includes("process_mercadopago_subscription_payment"), "Must include process_mercadopago_subscription_payment");
  assert.ok(names.includes("process_stripe_subscription_event"), "Must include process_stripe_subscription_event");
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

test("smoke-test-schema: checkRpcViaRest distinguishes FOUND, MISSING, AUTH_ERROR, SERVER_ERROR, NETWORK_ERROR", async () => {
  // 1. FOUND: HTTP 200
  const fetch200 = async () => ({ status: 200, json: async () => [] });
  const res200 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch200);
  assert.strictEqual(res200.status, RPC_STATUS.FOUND);
  assert.strictEqual(res200.exists, true);

  // 2. FOUND: HTTP 400 with parameter validation error (PGRST201)
  const fetch400 = async () => ({ status: 400, json: async () => ({ code: "PGRST201", message: "Missing required argument" }) });
  const res400 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch400);
  assert.strictEqual(res400.status, RPC_STATUS.FOUND);
  assert.strictEqual(res400.exists, true);

  // 3. MISSING: HTTP 404 with PGRST202
  const fetch404 = async () => ({ status: 404, json: async () => ({ code: "PGRST202", message: "Could not find function" }) });
  const res404 = await checkRpcViaRest("https://test.supabase.co", "missing_fn", "key", fetch404);
  assert.strictEqual(res404.status, RPC_STATUS.MISSING);
  assert.strictEqual(res404.exists, false);

  // 4. AUTH_ERROR: HTTP 401 (Unauthorized)
  const fetch401 = async () => ({ status: 401, json: async () => ({ message: "Invalid API key" }) });
  const res401 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "invalid_key", fetch401);
  assert.strictEqual(res401.status, RPC_STATUS.AUTH_ERROR);
  assert.strictEqual(res401.exists, false, "401 must NEVER be treated as RPC exists");

  // 5. AUTH_ERROR: HTTP 403 (Forbidden)
  const fetch403 = async () => ({ status: 403, json: async () => ({ message: "Permission denied" }) });
  const res403 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "anon_key", fetch403);
  assert.strictEqual(res403.status, RPC_STATUS.AUTH_ERROR);
  assert.strictEqual(res403.exists, false, "403 must NEVER be treated as RPC exists");

  // 6. SERVER_ERROR: HTTP 429 (Rate Limit)
  const fetch429 = async () => ({ status: 429, json: async () => ({ message: "Too many requests" }) });
  const res429 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch429);
  assert.strictEqual(res429.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(res429.exists, false, "429 must NEVER be treated as RPC exists");

  // 7. SERVER_ERROR: HTTP 500 / 503
  const fetch500 = async () => ({ status: 500, json: async () => ({ message: "Internal Server Error" }) });
  const res500 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch500);
  assert.strictEqual(res500.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(res500.exists, false, "500 must NEVER be treated as RPC exists");

  const fetch503 = async () => ({ status: 503, text: async () => "Service Unavailable" });
  const res503 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch503);
  assert.strictEqual(res503.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(res503.exists, false, "503 must NEVER be treated as RPC exists");

  // 8. NETWORK_ERROR: Network failure / timeout
  const fetchNetworkError = async () => {
    throw new TypeError("fetch failed: getaddrinfo ENOTFOUND test.supabase.co");
  };
  const resNetwork = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetchNetworkError);
  assert.strictEqual(resNetwork.status, RPC_STATUS.NETWORK_ERROR);
  assert.strictEqual(resNetwork.exists, false, "Network failure must NEVER be treated as RPC exists");

  // 9. Arbitrary unexpected status (e.g. 302 Redirect): must fail closed as SERVER_ERROR, not FOUND
  const fetch302 = async () => ({ status: 302, text: async () => "Found redirect" });
  const res302 = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", fetch302);
  assert.strictEqual(res302.status, RPC_STATUS.SERVER_ERROR);
  assert.strictEqual(res302.exists, false, "Arbitrary status must fail closed");
});

test("smoke-test-schema: runSmokeTest fails closed on MISSING, AUTH_ERROR, SERVER_ERROR and NETWORK_ERROR", async () => {
  const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };

  // A. Fails on MISSING
  const fetchMissing = async (url) => {
    if (url.includes("process_mercadopago_subscription_payment")) {
      return { status: 404, json: async () => ({ code: "PGRST202" }) };
    }
    return { status: 400, json: async () => ({ code: "PGRST201" }) };
  };
  const resMissing = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "key-1234",
    logger: mockLogger,
    fetchFn: fetchMissing,
    usePsql: false,
  });
  assert.strictEqual(resMissing.ok, false);
  assert.strictEqual(resMissing.missingCount, 1);

  // B. Fails on AUTH_ERROR (401)
  const fetchAuthError = async () => ({ status: 401, json: async () => ({ message: "Unauthorized" }) });
  const resAuth = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "key-1234",
    logger: mockLogger,
    fetchFn: fetchAuthError,
    usePsql: false,
  });
  assert.strictEqual(resAuth.ok, false, "Must fail closed if authentication is rejected");
  assert.ok(resAuth.errorCount > 0);

  // C. Fails on SERVER_ERROR (500)
  const fetchServerError = async () => ({ status: 500, json: async () => ({ message: "Internal server error" }) });
  const resServer = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "key-1234",
    logger: mockLogger,
    fetchFn: fetchServerError,
    usePsql: false,
  });
  assert.strictEqual(resServer.ok, false, "Must fail closed on server error");
  assert.ok(resServer.errorCount > 0);

  // D. Fails on NETWORK_ERROR
  const fetchNetwork = async () => { throw new Error("Connection reset by peer"); };
  const resNetwork = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "key-1234",
    logger: mockLogger,
    fetchFn: fetchNetwork,
    usePsql: false,
  });
  assert.strictEqual(resNetwork.ok, false, "Must fail closed on network error");
  assert.ok(resNetwork.errorCount > 0);
});

test("smoke-test-schema: runSmokeTest passes only when all critical RPCs are FOUND", async () => {
  const mockLogs = [];
  const mockLogger = {
    log: (m) => mockLogs.push(m),
    error: (m) => mockLogs.push(m),
    warn: (m) => mockLogs.push(m),
  };

  const mockFetch = async () => ({
    status: 400,
    json: async () => ({ code: "PGRST201" }),
  });

  const result = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "test-service-role-key-1234",
    logger: mockLogger,
    fetchFn: mockFetch,
    usePsql: false,
  });

  assert.strictEqual(result.ok, true, "Must succeed when all RPCs are FOUND");
  assert.ok(mockLogs.some((l) => typeof l === "string" && l.includes("SUCCESS")), "Must log success notice");
});

test("smoke-test-schema: verifyProductionSchema respects VERCEL_ENV and gates build", async () => {
  const mockLogger = { log: () => {}, error: () => {}, warn: () => {} };

  // 1. In non-production local environment, bypasses safely
  const localRes = await verifyProductionSchema({
    env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" },
    logger: mockLogger,
  });
  assert.strictEqual(localRes.ok, true);
  assert.strictEqual(localRes.bypassed, true);

  // 2. When SKIP_SCHEMA_VERIFY=1, bypasses explicitly
  const skipRes = await verifyProductionSchema({
    env: { SKIP_SCHEMA_VERIFY: "1", VERCEL_ENV: "production" },
    logger: mockLogger,
  });
  assert.strictEqual(skipRes.ok, true);
  assert.strictEqual(skipRes.bypassed, true);

  // 3. In production with missing RPC, fails closed
  const failFetch = async (url) => {
    if (url.includes("register_payment")) {
      return { status: 404, json: async () => ({ code: "PGRST202" }) };
    }
    return { status: 400, json: async () => ({ code: "PGRST201" }) };
  };

  const prodFailRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-key-1234",
    },
    logger: mockLogger,
    fetchFn: failFetch,
  });
  assert.strictEqual(prodFailRes.ok, false, "Production build gate must fail if RPC missing");
  assert.strictEqual(prodFailRes.strict, true);

  // 4. In production with all RPCs present, succeeds
  const passFetch = async () => ({ status: 400, json: async () => ({ code: "PGRST201" }) });
  const prodPassRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-key-1234",
    },
    logger: mockLogger,
    fetchFn: passFetch,
  });
  assert.strictEqual(prodPassRes.ok, true);
  assert.strictEqual(prodPassRes.strict, true);

  // 5. In Vercel Preview with incompatible remote schema, emits warning but does NOT block build (ok: true)
  const warnLogs = [];
  const previewWarnLogger = {
    log: () => {},
    error: () => {},
    warn: (m) => warnLogs.push(m),
  };
  const previewFailRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote-staging.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "preview-role-key",
    },
    logger: previewWarnLogger,
    fetchFn: failFetch,
  });
  assert.strictEqual(previewFailRes.ok, true, "Preview build must NOT be blocked by incompatible remote schema");
  assert.strictEqual(previewFailRes.warned, true, "Must flag warning in preview");
  assert.strictEqual(previewFailRes.preview, true);
  assert.ok(warnLogs.some((l) => typeof l === "string" && l.includes("WARNING")), "Must log warning notice");

  // 6. In Vercel Preview with unreachable/network failure, emits warning but does NOT block build (ok: true)
  const networkErrorFetch = async () => {
    throw new Error("Connection refused (network timeout)");
  };
  const previewNetworkRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote-staging.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "preview-role-key",
    },
    logger: previewWarnLogger,
    fetchFn: networkErrorFetch,
  });
  assert.strictEqual(previewNetworkRes.ok, true, "Preview build must NOT be blocked by network failure");
  assert.strictEqual(previewNetworkRes.warned, true);

  // 7. In Vercel Preview with explicit CHECK_SCHEMA_COMPATIBILITY=1, enforces strict gate
  const previewExplicitRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "preview",
      CHECK_SCHEMA_COMPATIBILITY: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote-staging.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "preview-role-key",
    },
    logger: mockLogger,
    fetchFn: failFetch,
  });
  assert.strictEqual(previewExplicitRes.ok, false, "CHECK_SCHEMA_COMPATIBILITY=1 must enforce strict fail-closed even in preview");
  assert.strictEqual(previewExplicitRes.strict, true);

  // 8. In production with unreachable database, fails closed
  const prodNetworkFailRes = await verifyProductionSchema({
    env: {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-key-1234",
    },
    logger: mockLogger,
    fetchFn: networkErrorFetch,
  });
  assert.strictEqual(prodNetworkFailRes.ok, false, "Production build gate must fail if database is unreachable");
  assert.strictEqual(prodNetworkFailRes.strict, true);
});

