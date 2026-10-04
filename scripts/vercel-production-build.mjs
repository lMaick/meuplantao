#!/usr/bin/env node
/**
 * MeuPlantao - Versioned Vercel production buildCommand (MAI-159).
 *
 * Sequence (technically guaranteed, not just documented):
 *   1. production rendezvous via scripts/vercel-production-gate.mjs
 *      (exact-SHA migration + strict schema job; preview/local bypass);
 *   2. write the release proof to `public/release-proof-<SHA>.json`
 *      BEFORE compiling — the Vercel builder collects `public/` from the
 *      source tree AFTER the buildCommand (see @vercel/next `getStaticFiles`),
 *      while files created inside `.next/` after `next build` are not
 *      reliably packaged (live 404 on f85a7e6 despite a verified
 *      `.next/static` proof). `public/` is never wiped by `next build`;
 *   3. `npm run build` (retains the strict semantic prebuild gate incl. the
 *      MAI-158 `schema_contract` version assert; NEVER `next build` direct);
 *   4. re-verify the proof on disk (same SHA, successful gate attestation).
 *      Any build failure or exception cleans the staged proof first, so no
 *      proof of a failed build can ever be promoted or reused. Cleanup only
 *      ever removes exact `release-proof-<40-hex>.json` names and is
 *      best-effort; verification stays authoritative.
 *
 * The proof is served by Next/Vercel as `/release-proof-<SHA>.json` from
 * `public/`. The middleware matcher explicitly excludes that path so it
 * stays anonymous with no other auth, routing or CSP change. The file is
 * gitignored build output carrying no secrets, user data or code.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateGate, FULL_SHA_REGEX } from "./vercel-production-gate.mjs";

export const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
export const PROOF_FILE_PREFIX = "release-proof-";
export const PROOF_FILE_SUFFIX = ".json";
// Exact proof names only: release-proof-<40-hex>.json. Never broader globs,
// so cleanup can never touch non-generated assets.
export const PROOF_FILE_PATTERN = /^release-proof-[0-9a-f]{40}\.json$/i;

export function proofFileName(sha) {
  return `${PROOF_FILE_PREFIX}${sha.toLowerCase()}${PROOF_FILE_SUFFIX}`;
}

/**
 * Removes stale proof artifacts from a previous local invocation so a
 * failed/blocked build can never leave behind a proof that a later smoke
 * could mistake for the current release. Only exact
 * `release-proof-<40-hex>.json` names directly inside outDir are touched;
 * everything else is preserved. Best-effort: verification stays authoritative.
 */
export function removeStaleProofs({ outDir }) {
  let entries;
  try {
    entries = readdirSync(outDir);
  } catch {
    return { removed: 0 };
  }
  let removed = 0;
  for (const entry of entries) {
    if (PROOF_FILE_PATTERN.test(entry)) {
      try {
        unlinkSync(join(outDir, entry));
        removed += 1;
      } catch {
        // Best-effort: a leftover is reported via verification anyway.
      }
    }
  }
  return { removed };
}

export function writeReleaseProof({ outDir, sha, gateProof, attestedAt }) {
  const fileName = proofFileName(sha);
  const body = {
    releaseGate: "mai-159-rendezvous",
    sha: sha.toLowerCase(),
    event: "push",
    branch: "main",
    gate: gateProof,
    // Attestation instant: when the gate cleared this SHA, BEFORE the app
    // build. It never claims the build finished — promotion is proven
    // separately by build exit 0 plus the exact-deployment smoke.
    attestedAt,
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
  const outDir = options.outDir || join(REPO_ROOT, "public");
  const nowIso = options.nowIso || (() => new Date().toISOString());

  const cleaned = removeStaleProofs({ outDir });
  if (cleaned.removed > 0) {
    logger.log(`[release-build] removed ${cleaned.removed} stale proof artifact(s) before gating.`);
  }

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

  const sha = (env.VERCEL_GIT_COMMIT_SHA || "").trim().toLowerCase();
  if (!FULL_SHA_REGEX.test(sha)) {
    logger.log("[release-build] BLOCKED: gated production context but commit SHA is invalid; refusing proof and build.");
    return { ok: false, gated: true, reason: "invalid-sha" };
  }
  const prePath = writeReleaseProof({ outDir, sha, gateProof: gate.proof, attestedAt: nowIso() });
  logger.log(`[release-build] proof staged pre-build at ${prePath}; invoking app build.`);

  try {
    const built = runAppBuild({ spawnImpl, logger });
    if (!built) {
      removeStaleProofs({ outDir });
      logger.log("[release-build] BLOCKED: gated app build failed; staged proof cleaned, nothing promoted.");
      return { ok: false, gated: true, reason: "gated-build-failed" };
    }
    const verified = verifyReleaseProof({ outDir, sha });
    if (!verified.ok) {
      removeStaleProofs({ outDir });
      logger.log(`[release-build] BLOCKED: proof integrity failed post-build (${verified.reason}); staged proof cleaned.`);
      return { ok: false, gated: true, reason: verified.reason };
    }
  } catch (error) {
    removeStaleProofs({ outDir });
    logger.log(`[release-build] BLOCKED: exception during gated build (${error?.message || error}); staged proof cleaned.`);
    return { ok: false, gated: true, reason: "gated-build-exception" };
  }
  logger.log(`[release-build] PROCEED gated production build ok; proof verified at ${prePath}.`);
  return { ok: true, gated: true, proofPath: prePath };
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
