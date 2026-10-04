import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function parsePinned(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.match(version, /^\d+\.\d+\.\d+$/, `expected exact pinned version, got: ${version}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

test("next stays on the patched 16.3.x line (MAI-157, GHSA-vcvr-r3jv-pc5j)", () => {
  const next = parsePinned(pkg.dependencies.next);
  assert.equal(next.major, 16, "no Next 17 major upgrade in this issue");
  assert.equal(next.minor, 3, "must stay on the 16.3.x line");
  assert.ok(next.patch >= 6, `16.3.6+ patches the critical next/og RCE, got: ${pkg.dependencies.next}`);
  const eslintPlugin = parsePinned(pkg.devDependencies["eslint-config-next"]);
  assert.equal(
    pkg.devDependencies["eslint-config-next"],
    pkg.dependencies.next,
    "eslint-config-next must stay pinned to the exact next version",
  );
  assert.ok(eslintPlugin.patch >= 6);
});

test("shadcn CLI lives in devDependencies, never in runtime dependencies (MAI-157)", () => {
  assert.ok(!("shadcn" in (pkg.dependencies ?? {})), "shadcn must not ship as a production dependency");
  assert.ok(
    "shadcn" in (pkg.devDependencies ?? {}),
    "shadcn CLI must remain available for builds via devDependencies",
  );
});

test("production audit gate script is production-only at high severity (MAI-157)", () => {
  const script = pkg.scripts?.["audit:prod"];
  assert.ok(script, "package.json must define an audit:prod script");
  assert.ok(script.includes("--omit=dev"), `audit gate must ignore dev-only findings, got: ${script}`);
  assert.ok(script.includes("--audit-level=high"), `audit gate must fail on high/critical, got: ${script}`);
});

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") collectSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("no JS/TS runtime import of shadcn in src (CSS theme import only, MAI-157)", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const files = collectSourceFiles(srcDir);
  assert.ok(files.length > 0, "expected source files under src/");
  const offenders = files.filter((file) => {
    const content = readFileSync(file, "utf8");
    return /(from\s+["']shadcn["']|require\(\s*["']shadcn["']|from\s+["']shadcn\/)/.test(content);
  });
  assert.deepEqual(offenders, [], `runtime shadcn imports would forbid the dev-only move: ${offenders.join(", ")}`);
});
