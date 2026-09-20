#!/usr/bin/env node
/**
 * MeuPlantao — Production Schema Pre-Build & Deployment Verification Gate
 *
 * Runs before build / deployment to verify that the target database schema
 * has all critical migrations and RPCs required by the application.
 *
 * Behavior:
 *  - In Vercel Production (`VERCEL_ENV=production`) or explicit mode (`CHECK_SCHEMA_COMPATIBILITY=1`):
 *    Strict fail-closed. If the schema is incompatible or unreachable, exit 1 to abort build.
 *  - In local development or CI mock build (`SKIP_SCHEMA_VERIFY=1` or offline localhost):
 *    Safe bypass with informative message, allowing Next.js static asset compilation.
 */

import { fileURLToPath } from "node:url";
import { runSmokeTest, redactSecrets } from "./smoke-test-schema.mjs";

export async function verifyProductionSchema(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;

  const isVercelProduction = env.VERCEL_ENV === "production";
  const isExplicit = env.CHECK_SCHEMA_COMPATIBILITY === "1";
  const isSkip = env.SKIP_SCHEMA_VERIFY === "1";

  if (isSkip) {
    logger.log("[SCHEMA-GATE] Schema verification bypassed via SKIP_SCHEMA_VERIFY=1.");
    return { ok: true, bypassed: true };
  }

  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "").trim();
  const isLocalOrPlaceholder =
    !supabaseUrl ||
    supabaseUrl.includes("localhost") ||
    supabaseUrl.includes("127.0.0.1") ||
    supabaseUrl.includes("your-project");

  const isStrict = isVercelProduction || isExplicit;

  if (isStrict) {
    logger.log("[SCHEMA-GATE] Strict schema verification active (Production / Explicit gate).");
    const result = await runSmokeTest({ env, logger, fetchFn: options.fetchFn });
    if (!result.ok) {
      logger.error("[SCHEMA-GATE] FATAL: Production database is missing critical migrations / RPCs!");
      logger.error("[SCHEMA-GATE] Aborting build/deploy to prevent serving broken code to users.");
      return { ok: false, strict: true };
    }
    logger.log("[SCHEMA-GATE] Production schema compatibility verified successfully.");
    return { ok: true, strict: true };
  }

  // Non-strict mode (local build, CI quality test)
  if (isLocalOrPlaceholder) {
    logger.log("[SCHEMA-GATE] Non-production environment detected (local/mock config).");
    logger.log("[SCHEMA-GATE] Skipping strict database schema gate for offline asset build.");
    logger.log("[SCHEMA-GATE] Run 'npm run db:smoke' or set CHECK_SCHEMA_COMPATIBILITY=1 to test live database.");
    return { ok: true, bypassed: true };
  }

  // If a remote URL is present even in non-strict, attempt check gently
  try {
    const result = await runSmokeTest({ env, logger, fetchFn: options.fetchFn });
    return result;
  } catch (err) {
    logger.warn(`[SCHEMA-GATE] Gentle check warning: ${redactSecrets(err?.message || String(err))}`);
    return { ok: true, warned: true };
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  verifyProductionSchema()
    .then((res) => {
      if (!res.ok) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[SCHEMA-GATE] Fatal error during schema gate:", redactSecrets(err?.message || String(err)));
      process.exit(1);
    });
}
