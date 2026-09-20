import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets, checkRpcViaRest, runSmokeTest, CRITICAL_RPCS } from "../scripts/smoke-test-schema.mjs";
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

test("smoke-test-schema: checkRpcViaRest detects present vs missing RPCs", async () => {
  const mockFetch = async (url) => {
    if (url.includes("/rpc/save_shift_with_obligation")) {
      // Simulates PostgREST status 400 when RPC exists but parameters are missing
      return {
        status: 400,
        json: async () => ({ code: "PGRST201", message: "Missing required argument" }),
      };
    }
    if (url.includes("/rpc/missing_function")) {
      // Simulates PostgREST 404 when RPC is missing from schema cache
      return {
        status: 404,
        json: async () => ({ code: "PGRST202", message: "Could not find function in schema cache" }),
      };
    }
    return { status: 404, text: async () => "Not found" };
  };

  const present = await checkRpcViaRest("https://test.supabase.co", "save_shift_with_obligation", "key", mockFetch);
  assert.strictEqual(present.exists, true);
  assert.strictEqual(present.status, 400);

  const missing = await checkRpcViaRest("https://test.supabase.co", "missing_function", "key", mockFetch);
  assert.strictEqual(missing.exists, false);
  assert.strictEqual(missing.status, 404);
});

test("smoke-test-schema: runSmokeTest fails closed when critical RPC is missing", async () => {
  const mockLogs = [];
  const mockLogger = {
    log: (m) => mockLogs.push(m),
    error: (m) => mockLogs.push(m),
    warn: (m) => mockLogs.push(m),
  };

  const mockFetch = async (url) => {
    // Return 404 only for process_mercadopago_subscription_payment
    if (url.includes("process_mercadopago_subscription_payment")) {
      return {
        status: 404,
        json: async () => ({ code: "PGRST202", message: "Could not find function in schema cache" }),
      };
    }
    // Others exist
    return {
      status: 400,
      json: async () => ({ code: "PGRST201" }),
    };
  };

  const result = await runSmokeTest({
    supabaseUrl: "https://test.supabase.co",
    serviceRoleKey: "test-service-role-key-1234",
    logger: mockLogger,
    fetchFn: mockFetch,
    usePsql: false,
  });

  assert.strictEqual(result.ok, false, "Must fail closed if an RPC is missing");
  assert.strictEqual(result.missingCount, 1);
  assert.ok(mockLogs.some((l) => typeof l === "string" && l.includes("FAIL-CLOSED")), "Must log fail-closed notice");
});

test("smoke-test-schema: runSmokeTest passes when all critical RPCs exist", async () => {
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

  assert.strictEqual(result.ok, true, "Must succeed when all RPCs exist");
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

