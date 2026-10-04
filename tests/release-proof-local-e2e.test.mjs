import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  proofFileName,
  writeReleaseProof,
} from "../scripts/vercel-production-build.mjs";
import { PINNED } from "../scripts/vercel-production-gate.mjs";
import { verifyRelease } from "../scripts/verify-production-release.mjs";

const SHA = "9".repeat(40);

/**
 * MAI-159 packaging regression: consumes a REAL proof file produced by the
 * REAL wrapper, served over REAL HTTP, verified by the REAL smoke path —
 * instead of only mirroring source regexes. Guards the f85a7e6 incident
 * class (proof verified in the build container yet unreachable when served).
 */
test("wrapper proof file served over HTTP passes the smoke attestation", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-e2e-"));
  const gateProof = {
    gateSpec: "1.0.0",
    sha: SHA,
    event: "push",
    branch: "main",
    workflow: { id: PINNED.workflowId, runId: 42, runAttempt: 1 },
    job: { id: 7, name: PINNED.jobName, conclusion: "success" },
    steps: PINNED.requiredSteps.map((name) => ({ name, conclusion: "success" })),
  };
  const fullPath = writeReleaseProof({ outDir, sha: SHA, gateProof, attestedAt: "2026-10-04T02:32:44.000Z" });
  assert.equal(fullPath, join(outDir, proofFileName(SHA)));

  const server = createServer((req, res) => {
    if (req.url === `/release-proof-${SHA}.json`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(readFileSync(fullPath));
    } else if (req.url === "/" || req.url === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const lines = [];
    const result = await verifyRelease({
      owner: "lMaick",
      repo: "meuplantao",
      sha: SHA,
      site: `http://127.0.0.1:${port}`,
      logger: { log: (m) => lines.push(String(m)) },
      timeoutMs: 30_000,
      pollIntervalMs: 1_000,
      fetchJson: async (url) => {
        if (url.includes("/statuses")) {
          return { ok: true, status: 200, json: [{ id: 9, state: "success" }] };
        }
        return {
          ok: true,
          status: 200,
          json: [{ id: 8, sha: SHA, environment: "Production", creator: { login: "vercel[bot]" } }],
        };
      },
    });
    assert.equal(result.ok, true, lines.join("\n"));
    assert.equal(result.deploymentId, 8);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the same loop blocks when the served file is absent (incident class)", async () => {
  const server = createServer((req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await verifyRelease({
      sha: SHA,
      site: `http://127.0.0.1:${port}`,
      logger: { log: () => {} },
      timeoutMs: 30_000,
      pollIntervalMs: 1_000,
      fetchJson: async (url) => {
        if (url.includes("/statuses")) {
          return { ok: true, status: 200, json: [{ id: 9, state: "success" }] };
        }
        return {
          ok: true,
          status: 200,
          json: [{ id: 8, sha: SHA, environment: "Production", creator: { login: "vercel[bot]" } }],
        };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /proof-http-404/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("proof filename helper is anchored to the exact reserved name", async () => {
  const mod = await import("../scripts/vercel-production-build.mjs");
  assert.equal(mod.proofFileName(SHA), `release-proof-${SHA}.json`);
  assert.match(mod.PROOF_FILE_PATTERN.source, /40/);
  assert.equal(mod.PROOF_FILE_PATTERN.test(`release-proof-${SHA}.json`), true);
  assert.equal(mod.PROOF_FILE_PATTERN.test("release-proof-abc.json"), false);
  assert.equal(mod.PROOF_FILE_PATTERN.test("release-proof-notes.txt"), false);
});
