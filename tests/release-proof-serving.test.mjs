import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(`${root}/${rel}`, "utf8");
const SHA = "a".repeat(40);

function matcherFromSource() {
  const source = read("src/middleware.ts");
  const m = source.match(/matcher:\s*\["(.*)"\]/);
  assert.ok(m, "middleware must declare a matcher");
  // The pattern lives in a TS string literal, so unescape `\\` -> `\`
  // to recover the real regex source before compiling it here.
  return new RegExp(`^${m[1].replace(/\\\\/g, "\\")}$`);
}

test("vercel.json routes the production build through the versioned wrapper", () => {
  const vercel = JSON.parse(read("vercel.json"));
  assert.equal(
    vercel.buildCommand,
    "node scripts/vercel-production-build.mjs",
    "dashboard default must stay overridden by the repo wrapper (H1 hypothesis for unreachable proofs, unconfirmed)",
  );
});

test("wrapper delegates to npm run build, never next build directly (strict prebuild retained)", () => {
  const source = read("scripts/vercel-production-build.mjs");
  assert.ok(
    source.includes('"npm", ["run", "build"]'),
    "wrapper must invoke `npm run build` so the strict semantic prebuild gate always runs",
  );
  assert.ok(
    !/spawn\w*\(\s*["']next["']/.test(source),
    "direct `next build` invocation would bypass prebuild and must never appear",
  );
});

test("proof is written to public/ pre-build (packaging evidence: post-build .next writes are not reliably collected)", () => {
  const source = read("scripts/vercel-production-build.mjs");
  assert.ok(
    source.includes('join(REPO_ROOT, "public")'),
    "proof outDir must default to public/, which the Vercel builder collects from the source tree after the buildCommand",
  );
  const writeIdx = source.indexOf("writeReleaseProof({ outDir, sha");
  const spawnIdx = source.indexOf("runAppBuild({ spawnImpl, logger })");
  assert.ok(writeIdx !== -1 && spawnIdx !== -1 && writeIdx < spawnIdx, "proof must be written before the app build starts");
});

test("proof path matches the smoke contract (same filename, root route)", () => {
  const buildSource = read("scripts/vercel-production-build.mjs");
  const smokeSource = read("scripts/verify-production-release.mjs");
  assert.ok(buildSource.includes("release-proof-${sha"), "wrapper must write release-proof-<sha>.json");
  assert.ok(
    smokeSource.includes("/release-proof-${sha}.json"),
    "smoke must fetch the proof from the public root route",
  );
  assert.ok(!smokeSource.includes("_next/static/release-proof"), "stale .next/static proof route must be gone");
});

test("middleware matcher leaves /release-proof-<sha>.json anonymous, nothing else changes", () => {
  const matcher = matcherFromSource();
  assert.equal(matcher.test(`/release-proof-${SHA}.json`), false, "proof URL must bypass middleware auth");
  assert.equal(matcher.test(`/release-proof-${SHA.toUpperCase()}.json`), false, "uppercase hex SHAs bypass too");
  // Spot-check the pre-existing contract is untouched.
  assert.equal(matcher.test("/robots.txt"), false);
  assert.equal(matcher.test("/_next/static/chunk.js"), false);
  assert.equal(matcher.test("/login"), true);
  assert.equal(matcher.test("/dashboard"), true);
  assert.equal(matcher.test("/release-proof.json"), true, "unshaped lookalikes must still hit middleware");
  assert.equal(matcher.test(`/release-proof-${"g".repeat(40)}.json`), true, "non-hex lookalikes must still hit middleware");
  assert.equal(matcher.test(`/release-proof-${SHA}.json/extra`), true);
});

test("proof artifacts are gitignored build output", () => {
  const gitignore = read(".gitignore");
  assert.ok(gitignore.includes("/public/release-proof-*.json"), "generated proofs must never be committed");
});

test("gate pins job-level attestation, never whole-run success (anti-deadlock + recovery)", () => {
  const source = read("scripts/vercel-production-gate.mjs");
  assert.ok(source.includes("Apply & Verify Production Schema"), "pinned job name must be present");
  assert.ok(source.includes("Apply Migrations to Production Database"), "required step must be pinned");
  assert.ok(source.includes("Production Schema Smoke Test (Fail-Closed)"), "required step must be pinned");
  assert.ok(
    !source.includes("run-conclusion-"),
    "run conclusion alone must never decide: a smoke-failed run with a green migrate job must allow rebuild",
  );
});
