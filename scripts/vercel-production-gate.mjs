#!/usr/bin/env node
/**
 * MeuPlantao - Serialized production release gate (MAI-159).
 *
 * Token-free rendezvous: the Vercel production build waits (via the public
 * GitHub Actions API) for the exact-commit migration + strict schema job of
 * the pinned `deploy-production.yml` workflow before compiling the app.
 *
 * Ordering guarantee (no deadlock):
 *   merge to main
 *     -> deploy-production.yml job `migrate-and-verify` (migrations + strict
 *        schema gate incl. MAI-158 semantic contract)
 *     -> Vercel production buildCommand waits ONLY for that job's
 *        completed/success (never for whole-workflow completion, so a later
 *        post-deploy smoke job in the same workflow cannot deadlock the build)
 *     -> `npm run build` (keeps the strict prebuild semantic recheck)
 *     -> release proof artifact + post-deploy smoke (separate job)
 *
 * Fail-closed contract:
 *   - non-production context (preview/development/local/CI) bypasses
 *     immediately and never blocks;
 *   - production context = VERCEL_ENV=production, or Vercel build (VERCEL=1)
 *     targeting the main branch (covers System Env Vars toggle-off);
 *   - production with missing/malformed VERCEL_GIT_COMMIT_SHA blocks;
 *   - transport errors, HTTP 403/429/5xx, timeouts, malformed/unknown
 *     payloads, missing job/steps, stale attempts, wrong SHA/workflow/branch/
 *     event, or any non-success terminal state block immediately;
 *   - bounded wait (~10 min, ~45 s polls, well under the 60 req/hour shared
 *     unauthenticated budget); budget exhaustion blocks instead of extending.
 *
 * Stdlib only (global fetch). Never logs tokens: auth travels exclusively in
 * the Authorization header; only run/job ids, statuses and conclusions are
 * logged. No secrets, no user data, no code contents leave the process.
 */

import { pathToFileURL } from "node:url";

export const GATE_SPEC_VERSION = "1.0.0";

export const PINNED = {
  owner: "lMaick",
  repo: "meuplantao",
  workflowId: 362947044,
  workflowPath: ".github/workflows/deploy-production.yml",
  branch: "main",
  event: "push",
  jobName: "Apply & Verify Production Schema",
  requiredSteps: [
    "Apply Migrations to Production Database",
    "Production Schema Smoke Test (Fail-Closed)",
  ],
};

export const FULL_SHA_REGEX = /^[0-9a-f]{40}$/i;
export const GATE_TIMEOUT_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 45 * 1000;
export const REQUEST_TIMEOUT_MS = 20 * 1000;

// Run statuses that mean "keep waiting for the pinned job".
const WAITING_RUN_STATUSES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
// Run conclusions that block immediately once the run is completed.
const BLOCKING_RUN_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
  "skipped",
  "neutral",
]);

function apiBase() {
  return "https://api.github.com";
}

function runsUrl(sha) {
  return (
    `${apiBase()}/repos/${PINNED.owner}/${PINNED.repo}` +
    `/actions/workflows/${PINNED.workflowId}/runs?head_sha=${sha}&per_page=5`
  );
}

function jobsUrl(runId) {
  return (
    `${apiBase()}/repos/${PINNED.owner}/${PINNED.repo}` +
    `/actions/runs/${runId}/jobs?filter=latest&per_page=30`
  );
}

/**
 * Default transport: single GitHub API GET with a hard per-request timeout.
 * Returns { ok, status, json } or { ok:false, error }.
 */
export async function githubApiGet(url, { token, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "meuplantao-release-gate",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: controller.signal });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name || "fetch-error" };
  } finally {
    clearTimeout(timer);
  }
}

function isProductionContext(env) {
  if (env.VERCEL_ENV === "production") return { production: true, via: "VERCEL_ENV=production" };
  const ref = env.VERCEL_GIT_COMMIT_REF || "";
  if (env.VERCEL === "1" && (ref === "main" || ref === "refs/heads/main")) {
    return { production: true, via: `VERCEL=1 ref=${ref} (System Env Vars fallback)` };
  }
  return { production: false, via: `VERCEL_ENV=${env.VERCEL_ENV || "(unset)"} ref=${ref || "(unset)"}` };
}

function matchRun(run, sha) {
  return (
    run &&
    typeof run.head_sha === "string" &&
    run.head_sha.toLowerCase() === sha &&
    run.head_branch === PINNED.branch &&
    run.event === PINNED.event &&
    (run.workflow_id === PINNED.workflowId || run.path === PINNED.workflowPath) &&
    run.workflow_id === PINNED.workflowId &&
    run.path === PINNED.workflowPath
  );
}

function newestRunFirst(a, b) {
  return (b.id || 0) - (a.id || 0);
}

/**
 * Checks the pinned migration/schema job inside one workflow run.
 * Returns { ready:true, proof } when the job is completed/success with all
 * required steps green, { ready:false, reason } when it is still pending, or
 * { ready:false, blocked, reason } when it can never satisfy the gate.
 */
export async function checkPinnedJob(fetchJson, run, { token, logger }) {
  let jobsRes;
  try {
    jobsRes = await fetchJson(jobsUrl(run.id), { token });
  } catch {
    return { ready: false, blocked: true, reason: `job-list transport error run=${run.id}` };
  }
  if (!jobsRes || !jobsRes.ok || !jobsRes.json || !Array.isArray(jobsRes.json.jobs)) {
    return {
      ready: false,
      blocked: true,
      reason: `job-list rejected run=${run.id} status=${jobsRes?.status ?? "?"}`,
    };
  }
  const job = jobsRes.json.jobs.find((j) => j && j.name === PINNED.jobName);
  if (!job) {
    return { ready: false, blocked: run.status === "completed", reason: `pinned job missing run=${run.id}` };
  }
  if (typeof job.run_attempt === "number" && typeof run.run_attempt === "number" && job.run_attempt !== run.run_attempt) {
    return {
      ready: false,
      blocked: true,
      reason: `stale job attempt job=${job.id} attempt=${job.run_attempt} run_attempt=${run.run_attempt}`,
    };
  }
  if (job.status !== "completed" || job.conclusion !== "success") {
    if (job.status === "completed") {
      return { ready: false, blocked: true, reason: `pinned job not successful job=${job.id} conclusion=${job.conclusion}` };
    }
    return { ready: false, blocked: false, reason: `pinned job pending job=${job.id} status=${job.status}` };
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  for (const wanted of PINNED.requiredSteps) {
    const step = steps.find((s) => s && s.name === wanted);
    if (!step || step.status !== "completed" || step.conclusion !== "success") {
      return {
        ready: false,
        blocked: true,
        reason: `required step not green step=${wanted} status=${step?.status ?? "missing"} conclusion=${step?.conclusion ?? "missing"}`,
      };
    }
  }
  return {
    ready: true,
    proof: {
      gateSpec: GATE_SPEC_VERSION,
      sha: run.head_sha.toLowerCase(),
      event: run.event,
      branch: run.head_branch,
      workflow: { id: PINNED.workflowId, path: PINNED.workflowPath, runId: run.id, runAttempt: run.run_attempt ?? null },
      job: { id: job.id, name: job.name, conclusion: job.conclusion, completedAt: job.completed_at ?? null },
      steps: PINNED.requiredSteps.map((name) => ({ name, conclusion: "success" })),
    },
  };
}

/**
 * Evaluates the gate. Returns { decision, reason, proof? } where decision is
 * PROCEED (build), BYPASS (non-production, build without waiting) or BLOCK.
 */
export async function evaluateGate(options = {}) {
  const env = options.env || process.env;
  const fetchJson = options.fetchJson || githubApiGet;
  const token = options.token || env.GITHUB_TOKEN || env.GH_TOKEN || null;
  const logger = options.logger || console;
  const timeoutMs = options.timeoutMs ?? GATE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const nowMs = options.nowMs || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const context = isProductionContext(env);
  const log = (message) => logger.log(`[release-gate] ${message}`);

  if (!context.production) {
    log(`BYPASS non-production context (${context.via}); building without rendezvous.`);
    return { decision: "BYPASS", reason: `non-production (${context.via})` };
  }

  const rawSha = (env.VERCEL_GIT_COMMIT_SHA || "").trim();
  if (!FULL_SHA_REGEX.test(rawSha)) {
    log("BLOCK invalid production context: VERCEL_GIT_COMMIT_SHA missing or malformed (expected full 40-hex).");
    return { decision: "BLOCK", reason: "invalid-production-sha" };
  }
  const sha = rawSha.toLowerCase();
  log(`production rendezvous for sha=${sha} via ${context.via}; pinned workflow=${PINNED.workflowId} job=${PINNED.jobName}.`);

  const deadline = nowMs() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let runsRes;
    try {
      runsRes = await fetchJson(runsUrl(sha), { token });
    } catch {
      log("BLOCK run-list transport error.");
      return { decision: "BLOCK", reason: "run-list-transport-error" };
    }
    if (!runsRes || !runsRes.ok || !runsRes.json || !Array.isArray(runsRes.json.workflow_runs)) {
      log(`BLOCK run-list rejected status=${runsRes?.status ?? "?"} (rate limit, auth wall or malformed payload).`);
      return { decision: "BLOCK", reason: `run-list-rejected-${runsRes?.status ?? "unknown"}` };
    }
    const candidates = runsRes.json.workflow_runs.filter((r) => matchRun(r, sha)).sort(newestRunFirst);
    if (candidates.length === 0) {
      if (nowMs() >= deadline) {
        log("BLOCK timeout: no matching push run for this SHA on main appeared in budget.");
        return { decision: "BLOCK", reason: "timeout-no-matching-run" };
      }
      log(`waiting (poll ${attempt}): no matching run yet; retrying.`);
      await sleep(pollIntervalMs);
      continue;
    }
    const run = candidates[0];
    log(`poll ${attempt}: run=${run.id} attempt=${run.run_attempt ?? "?"} status=${run.status} conclusion=${run.conclusion ?? "-"}.`);

    if (run.status === "completed") {
      if (run.conclusion !== "success") {
        log(`BLOCK run terminal without success conclusion=${run.conclusion}.`);
        return { decision: "BLOCK", reason: `run-conclusion-${run.conclusion}` };
      }
      const jobCheck = await checkPinnedJob(fetchJson, run, { token, logger });
      if (jobCheck.ready) {
        log(`PROCEED run=${run.id} job=${jobCheck.proof.job.id} pinned job green.`);
        return { decision: "PROCEED", reason: "pinned-job-success", proof: jobCheck.proof };
      }
      log(`BLOCK ${jobCheck.reason}.`);
      return { decision: "BLOCK", reason: jobCheck.reason };
    }

    if (!WAITING_RUN_STATUSES.has(run.status)) {
      log(`BLOCK unknown run status=${run.status}.`);
      return { decision: "BLOCK", reason: `unknown-run-status-${run.status}` };
    }

    if (run.status === "in_progress" || run.status === "waiting") {
      // Anti-deadlock: the pinned job may already be green while the run is
      // still active (e.g. a post-deploy smoke job awaits this very build).
      const jobCheck = await checkPinnedJob(fetchJson, run, { token, logger });
      if (jobCheck.ready) {
        log(`PROCEED run=${run.id} job=${jobCheck.proof.job.id} pinned job green while run active (no deadlock).`);
        return { decision: "PROCEED", reason: "pinned-job-success-run-active", proof: jobCheck.proof };
      }
      if (jobCheck.blocked) {
        log(`BLOCK ${jobCheck.reason}.`);
        return { decision: "BLOCK", reason: jobCheck.reason };
      }
      log(`waiting (poll ${attempt}): ${jobCheck.reason}.`);
    } else {
      log(`waiting (poll ${attempt}): run status=${run.status}.`);
    }

    if (nowMs() >= deadline) {
      log("BLOCK timeout: pinned job did not go green in budget.");
      return { decision: "BLOCK", reason: "timeout-pinned-job" };
    }
    await sleep(pollIntervalMs);
  }
}

async function main() {
  const result = await evaluateGate();
  if (result.decision === "BLOCK") {
    console.error(`[release-gate] BLOCKED: ${result.reason}`);
    process.exit(1);
  }
  console.log(`[release-gate] ${result.decision}: ${result.reason}`);
  process.exit(0);
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
    console.error(`[release-gate] BLOCKED: fatal ${error?.message || error}`);
    process.exit(1);
  });
}
