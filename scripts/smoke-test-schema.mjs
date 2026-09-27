#!/usr/bin/env node
/**
 * MeuPlantao — Supabase Schema & Critical RPC Smoke Test
 *
 * Verifies that the production database has all critical migrations and RPCs
 * required by the application runtime.
 *
 * Critical RPCs verified:
 *  - save_shift_with_obligation
 *  - register_payment
 *  - process_mercadopago_subscription_payment
 *  - process_stripe_subscription_event (while Stripe exists)
 *
 * Fails closed (exit code 1) if any critical RPC is missing or if the database
 * is unreachable in verification mode.
 *
 * NEVER prints secrets (service_role, anon key, DATABASE_URL passwords) in logs.
 */

import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";

const { Client: PgClient } = pg;

export const CRITICAL_RPCS = [
  {
    name: "save_shift_with_obligation",
    description: "Atomic shift creation/update & obligation synchronization",
    requiresServiceRole: false,
    expectedArgsCount: 11,
    expectedArgTypes: [
      "uuid",
      "uuid",
      "date",
      "time without time zone",
      "time without time zone",
      "numeric",
      "text",
      "date",
      "uuid",
      "uuid",
      "text",
    ],
  },
  {
    name: "register_payment",
    description: "Atomic payment registration & balance update",
    requiresServiceRole: false,
    expectedArgsCount: 3,
    expectedArgTypes: ["uuid", "numeric", "date"],
  },
  {
    name: "process_mercadopago_subscription_payment",
    description: "Mercado Pago subscription payment webhook processing & idempotency",
    requiresServiceRole: true,
    expectedArgsCount: 6,
    expectedArgTypes: ["text", "uuid", "integer", "integer", "numeric", "text"],
  },
  {
    name: "process_stripe_subscription_event",
    description: "Stripe subscription webhook processing (legacy fallback)",
    requiresServiceRole: true,
    expectedArgsCount: 9,
    expectedArgTypes: [
      "text",
      "text",
      "uuid",
      "text",
      "text",
      "text",
      "text",
      "timestamp with time zone",
      "boolean",
    ],
  },
];

/**
 * Universal secret redaction function to prevent leaking keys, passwords or JWTs.
 */
export function redactSecrets(text, extraSecrets = []) {
  if (typeof text !== "string") return String(text ?? "");
  let redacted = text;

  // Redact explicit secrets passed in
  for (const s of extraSecrets) {
    if (s && typeof s === "string" && s.trim().length >= 4) {
      redacted = redacted.replaceAll(s.trim(), "[REDACTED]");
    }
  }

  // Redact PostgreSQL connection passwords: postgres://user:password@host:port/db
  redacted = redacted.replace(/:\/\/([^:@]+):([^@]+)@/g, "://$1:[REDACTED]@");

  // Redact JWT tokens (header.payload.signature)
  redacted = redacted.replace(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]");

  // Redact Bearer tokens
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._~+/-]{10,}/gi, "Bearer [REDACTED]");

  // Redact apikey headers/params
  redacted = redacted.replace(/(apikey[:=]\s*)[A-Za-z0-9._~+/-]{10,}/gi, "$1[REDACTED]");

  return redacted;
}

export const RPC_STATUS = {
  FOUND: "FOUND",
  MISSING: "MISSING",
  AUTH_ERROR: "AUTH_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  SERVER_ERROR: "SERVER_ERROR",
};

/**
 * Normalizes PostgreSQL type names for robust, canonical comparison.
 */
export function normalizeArgTypes(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  return list.map((raw) => {
    let t = raw.toLowerCase().trim();
    if (t.startsWith("p_") || t.includes(" default ")) {
      t = t.replace(/\s+default\s+.*$/i, "").trim();
      const parts = t.split(/\s+/);
      if (parts.length > 1) {
        t = parts.slice(1).join(" ");
      }
    }

    if (t === "time" || t === "time without time zone") return "time without time zone";
    if (t === "timestamptz" || t === "timestamp with time zone") return "timestamp with time zone";
    if (t === "timestamp" || t === "timestamp without time zone") return "timestamp without time zone";
    if (t === "int" || t === "int4" || t === "integer") return "integer";
    if (t === "int8" || t === "bigint") return "bigint";
    if (t === "numeric" || t === "decimal") return "numeric";
    if (t === "bool" || t === "boolean") return "boolean";
    if (t === "text" || t === "varchar" || t === "character varying") return "text";
    if (t === "uuid") return "uuid";
    if (t === "jsonb" || t === "json") return "jsonb";
    return t;
  });
}

/**
 * Checks an RPC using PostgREST REST API.
 * Granular classification:
 *  - FOUND: HTTP 200, or HTTP 400/422 with unequivocal Postgres error code (e.g. 23514, 42501) proving function execution.
 *  - MISSING: HTTP 404 with PGRST202 or route not found.
 *  - AUTH_ERROR: HTTP 401 or 403 (invalid key / permission denied before function resolution).
 *  - SERVER_ERROR: HTTP 429 (rate limit), 5xx (gateway/server error), or ambiguous 400/422 without unequivocal Postgres proof.
 *  - NETWORK_ERROR: fetch exception, DNS error, timeout.
 */
export async function checkRpcViaRest(baseUrl, rpcName, apiKey, fetchFn = globalThis.fetch) {
  const url = `${baseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${rpcName}`;
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    let bodyText = "";
    let bodyJson = null;
    try {
      bodyJson = await response.json();
      bodyText = JSON.stringify(bodyJson);
    } catch {
      bodyText = await response.text().catch(() => "");
    }

    const httpStatus = response.status;

    // 1. HTTP 401 / 403: Auth failure — NEVER consider as proof of RPC existence
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        status: RPC_STATUS.AUTH_ERROR,
        exists: false,
        httpStatus,
        details: redactSecrets(bodyText, [apiKey]),
      };
    }

    // 2. HTTP 429 or 5xx: Server/gateway error or rate limit
    if (httpStatus === 429 || httpStatus >= 500) {
      return {
        status: RPC_STATUS.SERVER_ERROR,
        exists: false,
        httpStatus,
        details: redactSecrets(bodyText, [apiKey]),
      };
    }

    // 3. HTTP 404: Not found (PGRST202 function not in schema cache)
    if (httpStatus === 404 || bodyJson?.code === "PGRST202") {
      return {
        status: RPC_STATUS.MISSING,
        exists: false,
        httpStatus: 404,
        details: redactSecrets(bodyText, [apiKey]),
      };
    }

    // 4. HTTP 200-299: Successfully executed / reached
    if (httpStatus >= 200 && httpStatus < 300) {
      return {
        status: RPC_STATUS.FOUND,
        exists: true,
        httpStatus,
      };
    }

    // 5. HTTP 400 or 422:
    // Only accept unequivocal PostgreSQL execution errors generated inside the function body.
    // Ambiguous errors or generic 400/422 without unequivocal Postgres proof must fail closed.
    if (httpStatus === 400 || httpStatus === 422) {
      const pgCode = bodyJson?.code;
      const unequivocalPgCodes = ["23514", "23503", "23505", "23502", "42501", "P0001"];
      if (pgCode && unequivocalPgCodes.includes(pgCode)) {
        return {
          status: RPC_STATUS.FOUND,
          exists: true,
          httpStatus,
          details: redactSecrets(bodyText, [apiKey]),
        };
      }
      return {
        status: RPC_STATUS.SERVER_ERROR,
        exists: false,
        httpStatus,
        details: redactSecrets(bodyText || "Ambiguous response without unequivocal PostgreSQL execution proof", [apiKey]),
      };
    }

    // Any other unexpected status: fail closed as SERVER_ERROR, not FOUND
    return {
      status: RPC_STATUS.SERVER_ERROR,
      exists: false,
      httpStatus,
      details: redactSecrets(bodyText, [apiKey]),
    };
  } catch (err) {
    return {
      status: RPC_STATUS.NETWORK_ERROR,
      exists: false,
      error: redactSecrets(err?.message || String(err), [apiKey]),
    };
  }
}

/**
 * Parses query output (psql string or pg.Client rows) and verifies RPC existence matching
 * expected name, argument count, AND exact type sequence.
 */
export function parseProcRows(output, rpcs = CRITICAL_RPCS) {
  const foundProcs = new Map();

  if (typeof output === "string") {
    const lines = output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 2) {
        const name = parts[0];
        const argsCount = parseInt(parts[1], 10);
        const identityArgs = parts.slice(2).join("|");
        const normalizedTypes = normalizeArgTypes(identityArgs);
        if (!foundProcs.has(name)) {
          foundProcs.set(name, []);
        }
        foundProcs.get(name).push({ argsCount, identityArgs, normalizedTypes });
      }
    }
  } else if (Array.isArray(output)) {
    for (const row of output) {
      const name = row.proname || row.name;
      const argsCount = parseInt(row.pronargs ?? row.argsCount, 10);
      const identityArgs = row.argtypes || row.identityArgs || "";
      const normalizedTypes = normalizeArgTypes(identityArgs);
      if (name) {
        if (!foundProcs.has(name)) {
          foundProcs.set(name, []);
        }
        foundProcs.get(name).push({ argsCount, identityArgs, normalizedTypes });
      }
    }
  }

  const results = {};
  for (const rpc of rpcs) {
    const expectedTypes = normalizeArgTypes(rpc.expectedArgTypes);
    const matchingList = foundProcs.get(rpc.name) || [];

    // Find proc that matches BOTH argument count AND exact sequence of argument types
    const exactMatch = matchingList.find((p) => {
      if (p.argsCount !== rpc.expectedArgsCount) return false;
      if (p.normalizedTypes.length !== expectedTypes.length) return false;
      return p.normalizedTypes.every((t, i) => t === expectedTypes[i]);
    });

    if (exactMatch) {
      results[rpc.name] = {
        status: RPC_STATUS.FOUND,
        exists: true,
        argsCount: exactMatch.argsCount,
        argTypes: exactMatch.normalizedTypes,
        identityArgs: exactMatch.identityArgs,
        source: "postgres",
      };
    } else if (matchingList.length > 0) {
      // Function exists by name, but argument count or type sequence is incompatible
      const firstFound = matchingList[0];
      const countMismatch = firstFound.argsCount !== rpc.expectedArgsCount;
      const details = countMismatch
        ? `Incompatible signature argument count: found ${firstFound.argsCount}, expected ${rpc.expectedArgsCount}`
        : `Incompatible signature argument types: found (${firstFound.normalizedTypes.join(", ")}), expected (${expectedTypes.join(", ")})`;

      results[rpc.name] = {
        status: RPC_STATUS.MISSING,
        exists: false,
        incompatible: true,
        argsCount: firstFound.argsCount,
        expectedArgsCount: rpc.expectedArgsCount,
        foundTypes: firstFound.normalizedTypes,
        expectedTypes,
        details,
        source: "postgres",
      };
    } else {
      results[rpc.name] = {
        status: RPC_STATUS.MISSING,
        exists: false,
        details: "Function not found in public schema",
        source: "postgres",
      };
    }
  }

  return results;
}

// Backward-compatible alias for existing callers/tests
export const parsePsqlProcOutput = parseProcRows;

/**
 * Resolves PostgreSQL connection configuration for pg.Client.
 * Automatically configures SSL for cloud poolers (e.g. Supabase, AWS) while allowing local DBs without SSL.
 */
export function getPgClientConfig(databaseUrl) {
  const isLocal =
    !databaseUrl ||
    databaseUrl.includes("localhost") ||
    databaseUrl.includes("127.0.0.1") ||
    databaseUrl.includes("@localhost") ||
    databaseUrl.includes("@127.0.0.1");

  const config = {
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
  };

  if (!isLocal) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

/**
 * Checks RPC existence directly in Postgres via node-postgres (pg).
 * Queries pg_catalog (pg_proc, pg_namespace) to validate function name, argument count, and argument type sequence.
 */
export async function checkRpcsViaPg(databaseUrl, options = {}) {
  const ClientClass = options.Client || PgClient;
  let client = options.client || null;
  let shouldClose = false;

  try {
    if (!client) {
      const config = options.clientConfig || getPgClientConfig(databaseUrl);
      client = new ClientClass(config);
      shouldClose = true;
      await client.connect();
    }

    const rpcNames = CRITICAL_RPCS.map((r) => r.name);
    const sql = `
      select
        p.proname,
        p.pronargs,
        coalesce(oidvectortypes(p.proargtypes), pg_get_function_identity_arguments(p.oid), '') as argtypes
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1);
    `;

    const res = await client.query(sql, [rpcNames]);
    const results = parseProcRows(res.rows, CRITICAL_RPCS);
    return { ok: true, results, method: "pg" };
  } catch (err) {
    return {
      ok: false,
      status: RPC_STATUS.SERVER_ERROR,
      error: redactSecrets(err?.message || String(err), [databaseUrl]),
      method: "pg",
    };
  } finally {
    if (shouldClose && client && typeof client.end === "function") {
      try {
        await client.end();
      } catch {
        // Ignore disconnect cleanup errors
      }
    }
  }
}

/**
 * Optional/legacy check using psql CLI if explicitly requested.
 */
export function checkRpcsViaPsql(databaseUrl, options = {}) {
  try {
    const execFn = options.execFn || execFileSync;
    const rpcListSql = CRITICAL_RPCS.map((r) => `'${r.name}'`).join(", ");
    const sql = `select p.proname, p.pronargs, coalesce(oidvectortypes(p.proargtypes), pg_get_function_identity_arguments(p.oid), '') from pg_proc p join pg_namespace n on p.pronamespace = n.oid where n.nspname = 'public' and p.proname in (${rpcListSql});`;

    const output = execFn("psql", [databaseUrl, "-F", "|", "-Atqc", sql], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const results = parseProcRows(String(output), CRITICAL_RPCS);
    return { ok: true, results, method: "psql" };
  } catch (err) {
    return {
      ok: false,
      status: RPC_STATUS.SERVER_ERROR,
      error: redactSecrets(err?.message || String(err), [databaseUrl]),
      method: "psql",
    };
  }
}

/**
 * Main verification orchestrator.
 */
export async function runSmokeTest(options = {}) {
  const logger = options.logger || console;
  const env = options.env || process.env;
  const fetchFn = options.fetchFn || globalThis.fetch;

  const isVercelProduction = env.VERCEL_ENV === "production";
  const isExplicit = env.CHECK_SCHEMA_COMPATIBILITY === "1";
  const isStrict = options.strict !== undefined ? Boolean(options.strict) : Boolean(isVercelProduction || isExplicit);

  const supabaseUrl = (options.supabaseUrl || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (options.serviceRoleKey || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || "").trim();
  const anonKey = (options.anonKey || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();
  const databaseUrl = (options.databaseUrl || env.DATABASE_URL || env.PRODUCTION_DATABASE_URL || env.SUPABASE_DB_URL || "").trim();

  const extraSecrets = [serviceRoleKey, anonKey, databaseUrl].filter(Boolean);

  logger.log("=================================================");
  logger.log(" MeuPlantao — Production Schema & RPC Smoke Test ");
  logger.log("=================================================");

  // Mode 1: Strict mode requires DATABASE_URL and pg_proc verification via node-postgres (NO fallback to REST)
  if (isStrict) {
    if (!databaseUrl) {
      const msg = "[FAIL-CLOSED] Strict mode requires DATABASE_URL to verify exact RPC signatures via PostgreSQL pg_proc. REST cannot guarantee exact signature validation.";
      logger.error(msg);
      return { ok: false, strict: true, error: msg };
    }

    logger.log("[SMOKE] Checking functions directly via PostgreSQL (pg_catalog)...");
    let pgRes;
    if (options.execPsqlFn) {
      pgRes = checkRpcsViaPsql(databaseUrl, { execFn: options.execPsqlFn });
    } else {
      pgRes = await checkRpcsViaPg(databaseUrl, {
        Client: options.Client,
        client: options.pgClient || options.client,
        clientConfig: options.clientConfig,
      });
    }

    if (!pgRes.ok) {
      const msg = `[FAIL-CLOSED] PostgreSQL pg_proc verification failed in strict mode: ${pgRes.error}`;
      logger.error(msg);
      return { ok: false, strict: true, method: pgRes.method || "pg", error: pgRes.error, status: pgRes.status || RPC_STATUS.SERVER_ERROR };
    }

    let missingCount = 0;
    for (const rpc of CRITICAL_RPCS) {
      const res = pgRes.results[rpc.name];
      if (res?.status === RPC_STATUS.FOUND) {
        logger.log(`  ✓ ${rpc.name}: FOUND (${res.argsCount} args) - ${rpc.description}`);
      } else {
        logger.error(`  ✗ ${rpc.name}: ${res?.details || "MISSING in public schema!"}`);
        missingCount++;
      }
    }
    if (missingCount === 0) {
      logger.log("\n[SUCCESS] All critical RPCs and signatures confirmed present in PostgreSQL!");
      return { ok: true, strict: true, method: pgRes.method || "pg", results: pgRes.results };
    } else {
      logger.error(`\n[FAIL-CLOSED] ${missingCount} critical RPC(s) missing or incompatible in database.`);
      return { ok: false, strict: true, missingCount, method: pgRes.method || "pg", results: pgRes.results };
    }
  }

  // Mode 1 (non-strict): Check via node-postgres if DATABASE_URL is provided
  if (databaseUrl) {
    logger.log("[SMOKE] Checking functions directly via PostgreSQL (pg_catalog)...");
    let pgRes;
    if (options.execPsqlFn) {
      pgRes = checkRpcsViaPsql(databaseUrl, { execFn: options.execPsqlFn });
    } else {
      pgRes = await checkRpcsViaPg(databaseUrl, {
        Client: options.Client,
        client: options.pgClient || options.client,
        clientConfig: options.clientConfig,
      });
    }

    if (pgRes.ok) {
      let missingCount = 0;
      for (const rpc of CRITICAL_RPCS) {
        const res = pgRes.results[rpc.name];
        if (res?.status === RPC_STATUS.FOUND) {
          logger.log(`  ✓ ${rpc.name}: FOUND (${res.argsCount} args) - ${rpc.description}`);
        } else {
          logger.error(`  ✗ ${rpc.name}: ${res?.details || "MISSING in public schema!"}`);
          missingCount++;
        }
      }
      if (missingCount === 0) {
        logger.log("\n[SUCCESS] All critical RPCs and signatures confirmed present in PostgreSQL!");
        return { ok: true, method: pgRes.method || "pg", results: pgRes.results };
      } else {
        logger.error(`\n[FAIL-CLOSED] ${missingCount} critical RPC(s) missing or incompatible in database.`);
        return { ok: false, missingCount, method: pgRes.method || "pg", results: pgRes.results };
      }
    } else {
      logger.log(`[SMOKE] PostgreSQL check unavailable or failed (${pgRes.error}). Falling back to REST API...`);
    }
  }

  // Mode 2: Check via PostgREST REST API
  if (!supabaseUrl) {
    const msg = "[FAIL-CLOSED] Neither DATABASE_URL nor NEXT_PUBLIC_SUPABASE_URL is defined. Cannot verify schema.";
    logger.error(msg);
    return { ok: false, error: msg };
  }

  const effectiveKey = serviceRoleKey || anonKey;
  if (!effectiveKey) {
    const msg = "[FAIL-CLOSED] No API key provided (neither SUPABASE_SERVICE_ROLE_KEY nor NEXT_PUBLIC_SUPABASE_ANON_KEY).";
    logger.error(msg);
    return { ok: false, error: msg };
  }

  const isServiceRole = Boolean(serviceRoleKey);
  logger.log(`[SMOKE] Target URL: ${redactSecrets(supabaseUrl, extraSecrets)}`);
  logger.log(`[SMOKE] Auth Mode: ${isServiceRole ? "service_role (Full verification)" : "anon key (Limited verification)"}`);

  let missingCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const results = {};

  for (const rpc of CRITICAL_RPCS) {
    if (rpc.requiresServiceRole && !isServiceRole) {
      logger.warn(`  ✗ ${rpc.name}: SKIPPED (Requires SUPABASE_SERVICE_ROLE_KEY)`);
      results[rpc.name] = { status: "SKIPPED", skipped: true, reason: "requires_service_role", exists: false };
      skippedCount++;
      continue;
    }

    const check = await checkRpcViaRest(supabaseUrl, rpc.name, effectiveKey, fetchFn);
    results[rpc.name] = check;

    if (check.status === RPC_STATUS.FOUND) {
      logger.log(`  ✓ ${rpc.name}: FOUND (HTTP ${check.httpStatus})`);
    } else if (check.status === RPC_STATUS.MISSING) {
      logger.error(`  ✗ ${rpc.name}: MISSING! ${check.details || "Not found (404/PGRST202)"}`);
      missingCount++;
    } else if (check.status === RPC_STATUS.AUTH_ERROR) {
      logger.error(`  ✗ ${rpc.name}: AUTH_ERROR! Authentication rejected (HTTP ${check.httpStatus}). Cannot verify existence.`);
      errorCount++;
    } else if (check.status === RPC_STATUS.SERVER_ERROR) {
      logger.error(`  ✗ ${rpc.name}: SERVER_ERROR! Gateway/Server error (HTTP ${check.httpStatus}).`);
      errorCount++;
    } else if (check.status === RPC_STATUS.NETWORK_ERROR) {
      logger.error(`  ✗ ${rpc.name}: NETWORK_ERROR! ${check.error}`);
      errorCount++;
    } else {
      logger.error(`  ✗ ${rpc.name}: FAILED! Unknown check status.`);
      errorCount++;
    }
  }

  const totalFailures = missingCount + errorCount + skippedCount;
  if (totalFailures > 0) {
    logger.error(`\n[FAIL-CLOSED] Schema verification failed: ${missingCount} missing, ${errorCount} error(s), ${skippedCount} skipped on ${redactSecrets(supabaseUrl, extraSecrets)}.`);
    logger.error("Only functions with verified FOUND status are accepted. Deploy cannot proceed.");
    return { ok: false, missingCount, errorCount, skippedCount, totalFailures, results };
  }

  logger.log("\n[SUCCESS] All verified critical RPCs are present in Supabase schema cache (FOUND)!");
  return { ok: true, results };
}

// Execute directly when called from command line
const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  runSmokeTest()
    .then((result) => {
      if (!result.ok) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[FATAL] Uncaught error in smoke test:", redactSecrets(err?.message || String(err)));
      process.exit(1);
    });
}
