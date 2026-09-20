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

export const CRITICAL_RPCS = [
  {
    name: "save_shift_with_obligation",
    description: "Atomic shift creation/update & obligation synchronization",
    requiresServiceRole: false,
  },
  {
    name: "register_payment",
    description: "Atomic payment registration & balance update",
    requiresServiceRole: false,
  },
  {
    name: "process_mercadopago_subscription_payment",
    description: "Mercado Pago subscription payment webhook processing & idempotency",
    requiresServiceRole: true,
  },
  {
    name: "process_stripe_subscription_event",
    description: "Stripe subscription webhook processing (legacy fallback)",
    requiresServiceRole: true,
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
 * Checks an RPC using PostgREST REST API.
 * PostgREST returns HTTP 404 with code PGRST202 if the function does not exist in schema cache.
 * PostgREST returns HTTP 400 (missing parameters PGRST201) if the function exists.
 *
 * Granular classification:
 *  - FOUND: HTTP 200, or HTTP 400/422 proving function exists in schema cache.
 *  - MISSING: HTTP 404 with PGRST202 or route not found.
 *  - AUTH_ERROR: HTTP 401 or 403 (invalid key / permission denied before function resolution).
 *  - SERVER_ERROR: HTTP 429 (rate limit) or 5xx (server/gateway error).
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
    if (httpStatus === 404) {
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

    // 5. HTTP 400 or 422: Parameter validation or signature error by PostgREST
    // PostgREST returns 400 with PGRST201 ("Missing required argument") or 422 ("PGRST..."),
    // or Postgres error from function body, which proves the function exists in schema cache.
    if (httpStatus === 400 || httpStatus === 422) {
      if (bodyJson?.code === "PGRST202") {
        return {
          status: RPC_STATUS.MISSING,
          exists: false,
          httpStatus,
          details: redactSecrets(bodyText, [apiKey]),
        };
      }
      return {
        status: RPC_STATUS.FOUND,
        exists: true,
        httpStatus,
        details: redactSecrets(bodyText, [apiKey]),
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
 * Checks RPC existence directly in Postgres via psql if DATABASE_URL is available.
 */
export function checkRpcsViaPsql(databaseUrl) {
  try {
    const rpcListSql = CRITICAL_RPCS.map((r) => `'${r.name}'`).join(", ");
    const sql = `select proname from pg_proc join pg_namespace on pg_proc.pronamespace = pg_namespace.oid where nspname = 'public' and proname in (${rpcListSql});`;

    const output = execFileSync("psql", [databaseUrl, "-Atqc", sql], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const foundNames = new Set(output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    const results = {};

    for (const rpc of CRITICAL_RPCS) {
      const exists = foundNames.has(rpc.name);
      results[rpc.name] = {
        status: exists ? RPC_STATUS.FOUND : RPC_STATUS.MISSING,
        exists,
        source: "psql",
      };
    }

    return { ok: true, results };
  } catch (err) {
    return {
      ok: false,
      status: RPC_STATUS.SERVER_ERROR,
      error: redactSecrets(err?.message || String(err), [databaseUrl]),
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

  const supabaseUrl = (options.supabaseUrl || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (options.serviceRoleKey || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || "").trim();
  const anonKey = (options.anonKey || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();
  const databaseUrl = (options.databaseUrl || env.DATABASE_URL || env.SUPABASE_DB_URL || "").trim();

  const extraSecrets = [serviceRoleKey, anonKey, databaseUrl].filter(Boolean);

  logger.log("=================================================");
  logger.log(" MeuPlantao — Production Schema & RPC Smoke Test ");
  logger.log("=================================================");

  // Mode 1: Check via psql if DATABASE_URL is provided and psql is installed
  if (databaseUrl && options.usePsql !== false) {
    logger.log("[SMOKE] Checking functions directly via PostgreSQL (psql)...");
    const psqlRes = checkRpcsViaPsql(databaseUrl);
    if (psqlRes.ok) {
      let missingCount = 0;
      for (const rpc of CRITICAL_RPCS) {
        const res = psqlRes.results[rpc.name];
        if (res?.status === RPC_STATUS.FOUND) {
          logger.log(`  ✓ ${rpc.name}: FOUND (${rpc.description})`);
        } else {
          logger.error(`  ✗ ${rpc.name}: MISSING in public schema!`);
          missingCount++;
        }
      }
      if (missingCount === 0) {
        logger.log("\n[SUCCESS] All critical RPCs confirmed present in PostgreSQL!");
        return { ok: true, method: "psql", results: psqlRes.results };
      } else {
        logger.error(`\n[FAIL-CLOSED] ${missingCount} critical RPC(s) missing from database.`);
        return { ok: false, missingCount, method: "psql", results: psqlRes.results };
      }
    } else {
      logger.log(`[SMOKE] psql check unavailable or failed (${psqlRes.error}). Falling back to REST API...`);
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

  if (!isServiceRole) {
    logger.warn("[WARNING] Running smoke test without SUPABASE_SERVICE_ROLE_KEY. Webhook-only RPCs (Mercado Pago / Stripe) cannot be verified with anon key.");
  }

  let missingCount = 0;
  let errorCount = 0;
  const results = {};

  for (const rpc of CRITICAL_RPCS) {
    if (rpc.requiresServiceRole && !isServiceRole) {
      logger.log(`  - ${rpc.name}: SKIPPED (Requires SUPABASE_SERVICE_ROLE_KEY)`);
      results[rpc.name] = { status: "SKIPPED", skipped: true, reason: "requires_service_role", exists: false };
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

  const totalFailures = missingCount + errorCount;
  if (totalFailures > 0) {
    logger.error(`\n[FAIL-CLOSED] Schema verification failed: ${missingCount} missing, ${errorCount} error(s) on ${redactSecrets(supabaseUrl, extraSecrets)}.`);
    logger.error("Only functions with verified FOUND status are accepted. Deploy cannot proceed.");
    return { ok: false, missingCount, errorCount, totalFailures, results };
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
