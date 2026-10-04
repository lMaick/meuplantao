import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(`${root}/${rel}`, "utf8");

test("vercel.json routes the production build through the versioned wrapper (404-class guard)", () => {
  const vercel = JSON.parse(read("vercel.json"));
  assert.equal(
    vercel.buildCommand,
    "node scripts/vercel-production-build.mjs",
    "dashboard default must stay overridden by the repo wrapper; a dashboard override silently skips the gate and the proof (live 404 on f85a7e6)",
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

test("proof path matches the smoke contract (same filename, static route)", () => {
  const buildSource = read("scripts/vercel-production-build.mjs");
  const smokeSource = read("scripts/verify-production-release.mjs");
  assert.ok(buildSource.includes("release-proof-${sha"), "wrapper must write release-proof-<sha>.json");
  assert.ok(buildSource.includes('".next", "static"'), "proof must land under .next/static");
  assert.ok(
    smokeSource.includes("/_next/static/release-proof-${sha}.json"),
    "smoke must fetch the proof from the public /_next/static route",
  );
});

test("middleware matcher leaves /_next/static anonymous (else proof 404s/redirects)", () => {
  const source = read("src/middleware.ts");
  const matcher = source.match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(matcher, "middleware must declare a matcher");
  assert.ok(
    matcher[1].includes("_next/static"),
    "matcher must exclude _next/static so the proof stays reachable without auth changes",
  );
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
