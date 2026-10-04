#!/usr/bin/env node
/**
 * MeuPlantao - Versioned Vercel production buildCommand (MAI-159).
 *
 * Sequence (technically guaranteed, not just documented):
 *   1. production rendezvous via scripts/vercel-production-gate.mjs
 *      (exact-SHA migration + strict schema job; preview/local bypass);
 *   2. `npm run build` (retains the strict semantic prebuild gate incl. the
 *      MAI-158 `schema_contract` version assert; NEVER `next build` direct);
 *   3. on gated production success only, write verifiable proof to
 *      `.next/static/release-proof-<SHA>.json` (gitignored build output, no
 *      secrets/user data/code) and verify it parses with the same SHA.
 *
 * The proof is served by Next as `/_next/static/release-proof-<SHA>.json`,
 * which the middleware matcher already excludes from auth, so no auth,
 * routing or CSP change is required to fetch it anonymously post-deploy.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateGate, FULL_SHA_REGEX } from "./vercel-production-gate.mjs";

export const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

export function proofFileName(sha) {
  return `release-proof-${sha.toLowerCase()}.json`;
}

export function writeReleaseProof({ outDir, sha, gateProof, builtAt }) {
  const fileName = proofFileName(sha);
  const body = {
    releaseGate: "mai-159-rendezvous",
    sha: sha.toLowerCase(),
    event: "push",
    branch: "main",
    gate: gateProof,
    builtAt,
  };
  mkdirSync(outDir, { recursive: true });
  const fullPath = join(outDir, fileName);
  writeFileSync(fullPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return fullPath;
}

/** Re-reads the proof from disk: integrity check before reporting success. */
export function verifyReleaseProof({ outDir, sha }) {
  const fullPath = join(outDir, proofFileName(sha));
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch {
    return { ok: false, reason: "proof-unreadable", fullPath };
  }
  if (!parsed || parsed.sha !== sha.toLowerCase() || parsed.releaseGate !== "mai-159-rendezvous") {
    return { ok: false, reason: "proof-sha-mismatch", fullPath };
  }
  if (!parsed.gate || parsed.gate?.job?.conclusion !== "success") {
    return { ok: false, reason: "proof-gate-not-success", fullPath };
  }
  return { ok: true, fullPath };
}

function runAppBuild({ spawnImpl, logger }) {
  logger.log("[release-build] invoking `npm run build` (strict prebuild retained).");
  const result = spawnImpl("npm", ["run", "build"], { stdio: "inherit", shell: true });
  return result?.status === 0;
}

export async function runProductionBuild(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const spawnImpl =
    options.spawnImpl ||
    ((cmd, args, opts) => spawnSync(cmd, args, opts));
  const outDir = options.outDir || join(REPO_ROOT, ".next", "static");
  const nowIso = options.nowIso || (() => new Date().toISOString());

  const gate = await evaluateGate({ env, logger, ...options.gateOptions });
  if (gate.decision === "BLOCK") {
    logger.log(`[release-build] BLOCKED by release gate: ${gate.reason}. App build not started.`);
    return { ok: false, gated: true, reason: gate.reason };
  }
  if (gate.decision === "BYPASS") {
    logger.log("[release-build] gate bypassed (non-production); running app build without proof.");
    const built = runAppBuild({ spawnImpl, logger });
    return { ok: built, gated: false, reason: built ? "bypass-build-ok" : "bypass-build-failed" };
  }

  const built = runAppBuild({ spawnImpl, logger });
  if (!built) {
    logger.log("[release-build] BLOCKED: gated app build failed; no proof written.");
    return { ok: false, gated: true, reason: "gated-build-failed" };
  }
  const sha = (env.VERCEL_GIT_COMMIT_SHA || "").trim().toLowerCase();
  if (!FULL_SHA_REGEX.test(sha)) {
    logger.log("[release-build] BLOCKED: production build succeeded but commit SHA is invalid; refusing proof.");
    return { ok: false, gated: true, reason: "post-build-invalid-sha" };
  }
  const fullPath = writeReleaseProof({ outDir, sha, gateProof: gate.proof, builtAt: nowIso() });
  const verified = verifyReleaseProof({ outDir, sha });
  if (!verified.ok) {
    logger.log(`[release-build] BLOCKED: proof integrity failed (${verified.reason}).`);
    return { ok: false, gated: true, reason: verified.reason };
  }
  logger.log(`[release-build] PROCEED gated production build ok; proof verified at ${fullPath}.`);
  return { ok: true, gated: true, proofPath: fullPath };
}

async function main() {
  const result = await runProductionBuild();
  process.exit(result.ok ? 0 : 1);
}

const invokedAsCli = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  main().catch((error) => {
    console.error(`[release-build] BLOCKED: fatal ${error?.message || error}`);
    process.exit(1);
  });
}
