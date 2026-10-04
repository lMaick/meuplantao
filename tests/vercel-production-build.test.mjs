import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  proofFileName,
  runProductionBuild,
  verifyReleaseProof,
  writeReleaseProof,
} from "../scripts/vercel-production-build.mjs";
import { PINNED } from "../scripts/vercel-production-gate.mjs";

const SHA = "f".repeat(40);

function gateProof() {
  return {
    gateSpec: "1.0.0",
    sha: SHA,
    workflow: { id: PINNED.workflowId, runId: 1, runAttempt: 1 },
    job: { id: 2, name: PINNED.jobName, conclusion: "success" },
    steps: [],
  };
}

function prodEnv() {
  return { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA };
}

function greenGateFetch() {
  return async (url) => {
    if (url.includes("/actions/runs/")) {
      return {
        ok: true,
        status: 200,
        json: {
          jobs: [
            {
              id: 2,
              name: PINNED.jobName,
              status: "completed",
              conclusion: "success",
              run_attempt: 1,
              completed_at: "2026-10-04T00:32:37Z",
              steps: PINNED.requiredSteps.map((name) => ({ name, status: "completed", conclusion: "success" })),
            },
          ],
        },
      };
    }
    return {
      ok: true,
      status: 200,
      json: {
        workflow_runs: [
          {
            id: 1,
            head_sha: SHA,
            head_branch: "main",
            event: "push",
            workflow_id: PINNED.workflowId,
            path: PINNED.workflowPath,
            status: "completed",
            conclusion: "success",
            run_attempt: 1,
          },
        ],
      },
    };
  };
}

function captureLogger() {
  const lines = [];
  return { logger: { log: (m) => lines.push(String(m)) }, lines };
}

test("proof filename pins the exact SHA", () => {
  assert.equal(proofFileName(SHA), `release-proof-${SHA}.json`);
  assert.equal(proofFileName(SHA.toUpperCase()), `release-proof-${SHA}.json`);
});

test("proof round-trip writes verifiable attestation", () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-"));
  const fullPath = writeReleaseProof({ outDir, sha: SHA, gateProof: gateProof(), builtAt: "2026-10-04T00:00:00Z" });
  const verified = verifyReleaseProof({ outDir, sha: SHA });
  assert.equal(verified.ok, true);
  assert.equal(verified.fullPath, fullPath);
  const body = JSON.parse(readFileSync(fullPath, "utf8"));
  assert.equal(body.releaseGate, "mai-159-rendezvous");
  assert.equal(body.sha, SHA);
  assert.equal(body.gate.job.conclusion, "success");
});

test("tampered or missing proof fails verification", () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-tamper-"));
  writeReleaseProof({ outDir, sha: SHA, gateProof: gateProof(), builtAt: "2026-10-04T00:00:00Z" });
  const fullPath = join(outDir, proofFileName(SHA));
  const body = JSON.parse(readFileSync(fullPath, "utf8"));
  body.sha = "0".repeat(40);
  writeFileSync(fullPath, JSON.stringify(body), "utf8");
  assert.equal(verifyReleaseProof({ outDir, sha: SHA }).ok, false);
  assert.equal(verifyReleaseProof({ outDir: join(outDir, "missing"), sha: SHA }).ok, false);
});

test("bypass runs the app build without writing proof", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-bypass-"));
  const spawned = [];
  const { logger } = captureLogger();
  const result = await runProductionBuild({
    env: { VERCEL_ENV: "preview" },
    logger,
    outDir,
    spawnImpl: (cmd, args) => {
      spawned.push([cmd, args]);
      return { status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.gated, false);
  assert.deepEqual(spawned, [["npm", ["run", "build"]]]);
  assert.equal(verifyReleaseProof({ outDir, sha: SHA }).ok, false);
});

test("blocked gate never starts the app build", async () => {
  let spawned = 0;
  const { logger } = captureLogger();
  const result = await runProductionBuild({
    env: prodEnv(),
    logger,
    outDir: mkdtempSync(join(tmpdir(), "proof-blocked-")),
    spawnImpl: () => {
      spawned += 1;
      return { status: 0 };
    },
    gateOptions: { fetchJson: async () => ({ ok: false, status: 403, json: null }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.gated, true);
  assert.equal(spawned, 0);
});

test("gated build writes verified proof on success", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-gated-ok-"));
  const { logger } = captureLogger();
  const result = await runProductionBuild({
    env: prodEnv(),
    logger,
    outDir,
    spawnImpl: () => ({ status: 0 }),
    gateOptions: { fetchJson: greenGateFetch() },
  });
  assert.equal(result.ok, true);
  assert.equal(verifyReleaseProof({ outDir, sha: SHA }).ok, true);
});

test("proof exists before the app build starts (public/ packaging contract)", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-prebuild-"));
  const { logger } = captureLogger();
  let proofExistedAtSpawn = false;
  const { verifyReleaseProof: verify } = await import("../scripts/vercel-production-build.mjs");
  const result = await runProductionBuild({
    env: prodEnv(),
    logger,
    outDir,
    spawnImpl: () => {
      proofExistedAtSpawn = verify({ outDir, sha: SHA }).ok;
      return { status: 0 };
    },
    gateOptions: { fetchJson: greenGateFetch() },
  });
  assert.equal(result.ok, true);
  assert.equal(proofExistedAtSpawn, true, "builder collects public/ after the buildCommand, so the proof must predate the build");
});

test("gated build failure blocks promotion even though the proof was staged pre-build", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-gated-fail-"));
  const { logger } = captureLogger();
  const result = await runProductionBuild({
    env: prodEnv(),
    logger,
    outDir,
    spawnImpl: () => ({ status: 1 }),
    gateOptions: { fetchJson: greenGateFetch() },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "gated-build-failed");
  // Failed builds are never deployed, so a staged proof file is harmless;
  // what matters is the BLOCKED result.
});
