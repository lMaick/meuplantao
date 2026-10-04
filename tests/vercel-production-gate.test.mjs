import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FULL_SHA_REGEX,
  GATE_SPEC_VERSION,
  PINNED,
  checkPinnedJob,
  evaluateGate,
} from "../scripts/vercel-production-gate.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

function prodEnv(overrides = {}) {
  return { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: SHA, ...overrides };
}

function makeClock(start = 1_000_000) {
  let now = start;
  const sleeps = [];
  return {
    nowMs: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

function captureLogger() {
  const lines = [];
  return { logger: { log: (m) => lines.push(String(m)) }, lines };
}

function runPayload(overrides = {}) {
  return {
    id: 37169001187,
    head_sha: SHA,
    head_branch: "main",
    event: "push",
    workflow_id: PINNED.workflowId,
    path: PINNED.workflowPath,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    ...overrides,
  };
}

function greenJob(overrides = {}) {
  return {
    id: 111337916754,
    name: PINNED.jobName,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    completed_at: "2026-10-04T00:32:37Z",
    steps: PINNED.requiredSteps.map((name) => ({ name, status: "completed", conclusion: "success" })),
    ...overrides,
  };
}

/** Queued fetch mock: pops scripted responses per URL kind. */
function mockFetch({ runs = [], jobs = [] } = {}) {
  const calls = [];
  const runsQueue = [...runs];
  const jobsQueue = [...jobs];
  let lastRuns = null;
  let lastJobs = null;
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/actions/runs/")) {
      const next = jobsQueue.length > 0 ? jobsQueue.shift() : lastJobs;
      lastJobs = next;
      if (next instanceof Error) throw next;
      return next;
    }
    const next = runsQueue.length > 0 ? runsQueue.shift() : lastRuns;
    lastRuns = next;
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchJson, calls };
}

const okRuns = (list) => ({ ok: true, status: 200, json: { total_count: list.length, workflow_runs: list } });
const okJobs = (list) => ({ ok: true, status: 200, json: { total_count: list.length, jobs: list } });

async function evaluate(overrides = {}, fetchMocks = {}) {
  const clock = makeClock();
  const { logger, lines } = captureLogger();
  const { fetchJson, calls } = mockFetch(fetchMocks);
  const result = await evaluateGate({
    logger,
    nowMs: clock.nowMs,
    sleep: clock.sleep,
    timeoutMs: 120_000,
    pollIntervalMs: 45_000,
    ...overrides,
    fetchJson: overrides.fetchJson || fetchJson,
  });
  return { result, lines, calls, clock };
}

test("pinned constants match the audited release contract (MAI-159)", () => {
  assert.equal(PINNED.owner, "lMaick");
  assert.equal(PINNED.repo, "meuplantao");
  assert.equal(PINNED.workflowId, 362947044);
  assert.equal(PINNED.workflowPath, ".github/workflows/deploy-production.yml");
  assert.equal(PINNED.branch, "main");
  assert.equal(PINNED.event, "push");
  assert.equal(PINNED.jobName, "Apply & Verify Production Schema");
  assert.deepEqual(PINNED.requiredSteps, [
    "Apply Migrations to Production Database",
    "Production Schema Smoke Test (Fail-Closed)",
  ]);
  assert.match(GATE_SPEC_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(FULL_SHA_REGEX.test("f".repeat(40)));
  assert.ok(!FULL_SHA_REGEX.test("abc123"));
  assert.ok(!FULL_SHA_REGEX.test("a".repeat(39)));
});

test("preview bypasses immediately without any API call", async () => {
  const { result, calls } = await evaluate({ env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: SHA } });
  assert.equal(result.decision, "BYPASS");
  assert.deepEqual(calls, []);
});

test("local and CI contexts bypass without any API call", async () => {
  for (const env of [{}, { VERCEL_ENV: "development" }, { CI: "true" }]) {
    const { result, calls } = await evaluate({ env });
    assert.equal(result.decision, "BYPASS", JSON.stringify(env));
    assert.deepEqual(calls, []);
  }
});

test("production with missing or malformed SHA blocks without API calls", async () => {
  for (const sha of ["", "abc123", "z".repeat(40), "a".repeat(39), `${SHA}\n${SHA}`]) {
    const { result, calls } = await evaluate({ env: prodEnv({ VERCEL_GIT_COMMIT_SHA: sha }) });
    assert.equal(result.decision, "BLOCK", sha);
    assert.equal(result.reason, "invalid-production-sha");
    assert.deepEqual(calls, []);
  }
});

test("Vercel main build without System Env Vars still gates (fail-closed fallback)", async () => {
  const { result } = await evaluate(
    { env: { VERCEL: "1", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: SHA } },
    { runs: [okRuns([runPayload()])], jobs: [okJobs([greenJob()])] },
  );
  assert.equal(result.decision, "PROCEED");
});

test("Vercel non-main ref without VERCEL_ENV bypasses", async () => {
  const { result, calls } = await evaluate({
    env: { VERCEL: "1", VERCEL_GIT_COMMIT_REF: "preview-branch", VERCEL_GIT_COMMIT_SHA: SHA },
  });
  assert.equal(result.decision, "BYPASS");
  assert.deepEqual(calls, []);
});

test("PROCEED on completed run with green pinned job; secrets never logged", async () => {
  const token = "SECRET-TOKEN-XYZ-123";
  const { result, lines } = await evaluate(
    { env: prodEnv(), token },
    { runs: [okRuns([runPayload()])], jobs: [okJobs([greenJob()])] },
  );
  assert.equal(result.decision, "PROCEED");
  assert.equal(result.proof.sha, SHA);
  assert.equal(result.proof.gateSpec, GATE_SPEC_VERSION);
  assert.equal(result.proof.workflow.runId, 37169001187);
  assert.equal(result.proof.job.conclusion, "success");
  assert.ok(!lines.join("\n").includes(token), "token must never appear in logs");
});

test("PROCEED while run still in_progress once the pinned job is green (no deadlock)", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload({ status: "in_progress", conclusion: null })])], jobs: [okJobs([greenJob()])] },
  );
  assert.equal(result.decision, "PROCEED");
  assert.equal(result.reason, "pinned-job-success-run-active");
});

test("completed run with failed conclusion but green pinned job PROCEEDs (rebuild/recovery allowed)", async () => {
  // Live incident shape (f85a7e6): run conclusion=failure came from the
  // post-deploy smoke of a previous attempt; the migration/schema job is
  // green for this exact SHA, so rebuilding must not self-lock.
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload({ conclusion: "failure" })])], jobs: [okJobs([greenJob()])] },
  );
  assert.equal(result.decision, "PROCEED");
  assert.equal(result.proof.runConclusion, "failure");
});

test("completed run with failed conclusion and red pinned job BLOCKs", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    {
      runs: [okRuns([runPayload({ conclusion: "failure" })])],
      jobs: [okJobs([greenJob({ status: "completed", conclusion: "failure" })])],
    },
  );
  assert.equal(result.decision, "BLOCK");
});

test("cancelled run with green pinned job PROCEEDs (job attestation governs)", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload({ conclusion: "cancelled" })])], jobs: [okJobs([greenJob()])] },
  );
  assert.equal(result.decision, "PROCEED");
});

test("completed success run with missing pinned job blocks (workflow edited)", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload()])], jobs: [okJobs([{ ...greenJob(), name: "Renamed Job" }])] },
  );
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reason, /pinned job missing/);
});

test("failed required step blocks", async () => {
  const job = greenJob();
  job.steps[1] = { name: PINNED.requiredSteps[1], status: "completed", conclusion: "failure" };
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload()])], jobs: [okJobs([job])] },
  );
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reason, /required step not green/);
});

test("missing required step blocks", async () => {
  const job = greenJob({ steps: [greenJob().steps[0]] });
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload()])], jobs: [okJobs([job])] },
  );
  assert.equal(result.decision, "BLOCK");
});

test("stale job attempt blocks", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload({ run_attempt: 2 })])], jobs: [okJobs([greenJob({ run_attempt: 1 })])] },
  );
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reason, /stale job attempt/);
});

test("failed pinned job on active run blocks", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    {
      runs: [okRuns([runPayload({ status: "in_progress", conclusion: null })])],
      jobs: [okJobs([greenJob({ status: "completed", conclusion: "failure" })])],
    },
  );
  assert.equal(result.decision, "BLOCK");
});

test("other-SHA runs are ignored and time out", async () => {
  const { result } = await evaluate(
    { env: prodEnv(), timeoutMs: 1, pollIntervalMs: 1 },
    { runs: [okRuns([runPayload({ head_sha: OTHER_SHA })])] },
  );
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "timeout-no-matching-run");
});

test("workflow_dispatch runs never count as migration proof", async () => {
  const { result } = await evaluate(
    { env: prodEnv(), timeoutMs: 1, pollIntervalMs: 1 },
    { runs: [okRuns([runPayload({ event: "workflow_dispatch" })])] },
  );
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.reason, "timeout-no-matching-run");
});

test("wrong branch and wrong workflow are rejected", async () => {
  for (const bad of [
    { head_branch: "staging" },
    { workflow_id: 351170589, path: ".github/workflows/ci.yml" },
    { workflow_id: 362947044, path: ".github/workflows/ci.yml" },
  ]) {
    const { result } = await evaluate(
      { env: prodEnv(), timeoutMs: 1, pollIntervalMs: 1 },
      { runs: [okRuns([runPayload(bad)])] },
    );
    assert.equal(result.decision, "BLOCK", JSON.stringify(bad));
  }
});

test("HTTP 403, 429 and 500 block immediately", async () => {
  for (const status of [403, 429, 500]) {
    const { result, calls } = await evaluate(
      { env: prodEnv() },
      { runs: [{ ok: false, status, json: { message: "blocked" } }] },
    );
    assert.equal(result.decision, "BLOCK", `status ${status}`);
    assert.equal(calls.length, 1, "no retry past a rejected response");
  }
});

test("malformed and unknown payloads block", async () => {
  for (const json of [null, {}, { workflow_runs: "nope" }, { totally: "unknown" }]) {
    const { result } = await evaluate(
      { env: prodEnv() },
      { runs: [{ ok: true, status: 200, json }] },
    );
    assert.equal(result.decision, "BLOCK");
  }
});

test("unknown run status blocks", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload({ status: "weird_state", conclusion: null })])] },
  );
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reason, /unknown-run-status/);
});

test("transport errors block", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [new Error("boom")] },
  );
  assert.equal(result.decision, "BLOCK");
});

test("job-list rejection blocks", async () => {
  const { result } = await evaluate(
    { env: prodEnv() },
    { runs: [okRuns([runPayload()])], jobs: [{ ok: false, status: 500, json: null }] },
  );
  assert.equal(result.decision, "BLOCK");
});

test("queued run waits, then proceeds once the job is green", async () => {
  const clock = makeClock();
  const { logger } = captureLogger();
  const { fetchJson } = mockFetch({
    runs: [okRuns([runPayload({ status: "queued", conclusion: null })]), okRuns([runPayload()])],
    jobs: [okJobs([greenJob()])],
  });
  const result = await evaluateGate({
    env: prodEnv(),
    logger,
    fetchJson,
    nowMs: clock.nowMs,
    sleep: clock.sleep,
    timeoutMs: 200_000,
    pollIntervalMs: 45_000,
  });
  assert.equal(result.decision, "PROCEED");
  assert.ok(clock.sleeps.length >= 1, "expected at least one bounded wait");
  assert.ok(clock.sleeps.every((ms) => ms <= 60_000), "no single sleep exceeds 60s");
});

test("timeout while the run never finishes blocks", async () => {
  const { result } = await evaluate(
    { env: prodEnv(), timeoutMs: 50_000, pollIntervalMs: 45_000 },
    {
      runs: [okRuns([runPayload({ status: "in_progress", conclusion: null })])],
      jobs: [okJobs([greenJob({ status: "in_progress", conclusion: null })])],
    },
  );
  assert.equal(result.decision, "BLOCK");
});

test("checkPinnedJob reports pending (not blocked) for active jobs", async () => {
  const { logger } = captureLogger();
  const pending = greenJob({ status: "in_progress", conclusion: null });
  const fetchJson = async () => okJobs([pending]);
  const checked = await checkPinnedJob(fetchJson, runPayload({ status: "in_progress", conclusion: null }), {
    token: null,
    logger,
  });
  assert.equal(checked.ready, false);
  assert.equal(checked.blocked, false);
});
