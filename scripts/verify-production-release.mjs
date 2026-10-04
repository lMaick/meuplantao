#!/usr/bin/env node
/**
 * MeuPlantao - Post-deploy production smoke (MAI-159).
 *
 * Runs as the `post-deploy-smoke` job of deploy-production.yml (needs the
 * migration/schema job). For the exact push SHA it:
 *   1. waits for the GitHub `Production` environment deployment created by
 *      `vercel[bot]` to reach `success` (anything else fails closed; a
 *      superseded/inactive deployment fails closed too — never accepts an
 *      old alias or page success as proof of the new release);
 *   2. fetches `/_next/static/release-proof-<SHA>.json` and requires the
 *      same SHA plus a successful gate attestation inside;
 *   3. GETs `/` and `/sitemap.xml` (safe, anonymous, no billing actions).
 *
 * Read-only against the site; bounded wait (~10 min); token optional
 * (GITHUB_TOKEN when running in Actions, anonymous public API otherwise).
 * Never logs tokens or response bodies.
 */

import { pathToFileURL } from "node:url";
import { githubApiGet } from "./vercel-production-gate.mjs";

export const SMOKE_TIMEOUT_MS = 10 * 60 * 1000;
export const SMOKE_POLL_INTERVAL_MS = 30 * 1000;
export const HTTP_TIMEOUT_MS = 20 * 1000;
export const FULL_SHA_REGEX = /^[0-9a-f]{40}$/i;
export const PRODUCTION_CREATOR = "vercel[bot]";
export const PRODUCTION_ENVIRONMENT = "Production";

export function deploymentsUrl(owner, repo, sha) {
  return (
    `https://api.github.com/repos/${owner}/${repo}` +
    `/deployments?environment=${PRODUCTION_ENVIRONMENT}&per_page=30&sha=${sha}`
  );
}

export function statusesUrl(owner, repo, deploymentId) {
  return `https://api.github.com/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`;
}

async function httpGetText(url, { timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "meuplantao-release-smoke" },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name || "fetch-error" };
  } finally {
    clearTimeout(timer);
  }
}

function pickDeployment(deployments, sha) {
  const matches = (deployments || []).filter(
    (d) =>
      d &&
      typeof d.sha === "string" &&
      d.sha.toLowerCase() === sha &&
      d.environment === PRODUCTION_ENVIRONMENT &&
      d.creator?.login === PRODUCTION_CREATOR,
  );
  matches.sort((a, b) => (b.id || 0) - (a.id || 0));
  return matches[0] || null;
}

function pickStatus(statuses) {
  const list = (statuses || []).filter((s) => s && typeof s.state === "string");
  list.sort((a, b) => (b.id || 0) - (a.id || 0));
  return list[0] || null;
}

export async function verifyRelease(options = {}) {
  const owner = options.owner || "lMaick";
  const repo = options.repo || "meuplantao";
  const rawSha = (options.sha || "").trim();
  const site = (options.site || "https://meuplantao.pro").replace(/\/$/, "");
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  const fetchJson = options.fetchJson || githubApiGet;
  const fetchText = options.fetchText || httpGetText;
  const logger = options.logger || console;
  const timeoutMs = options.timeoutMs ?? SMOKE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? SMOKE_POLL_INTERVAL_MS;
  const nowMs = options.nowMs || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = (message) => logger.log(`[release-smoke] ${message}`);

  if (!FULL_SHA_REGEX.test(rawSha)) {
    log("BLOCK invalid release SHA (expected full 40-hex).");
    return { ok: false, reason: "invalid-sha" };
  }
  const sha = rawSha.toLowerCase();
  log(`waiting for Production deployment of sha=${sha} by ${PRODUCTION_CREATOR}.`);

  const deadline = nowMs() + timeoutMs;
  let deployment = null;
  let poll = 0;
  for (;;) {
    poll += 1;
    let res;
    try {
      res = await fetchJson(deploymentsUrl(owner, repo, sha), { token });
    } catch {
      log("BLOCK deployments transport error.");
      return { ok: false, reason: "deployments-transport-error" };
    }
    if (!res || !res.ok || !Array.isArray(res.json)) {
      log(`BLOCK deployments rejected status=${res?.status ?? "?"} (rate limit, auth wall or malformed).`);
      return { ok: false, reason: `deployments-rejected-${res?.status ?? "unknown"}` };
    }
    deployment = pickDeployment(res.json, sha);
    if (deployment) break;
    if (nowMs() >= deadline) {
      log("BLOCK timeout: no Production deployment for this SHA appeared in budget.");
      return { ok: false, reason: "timeout-no-deployment" };
    }
    log(`waiting (poll ${poll}): deployment not listed yet.`);
    await sleep(pollIntervalMs);
  }

  log(`deployment=${deployment.id} found; waiting for success status.`);
  for (;;) {
    poll += 1;
    let res;
    try {
      res = await fetchJson(statusesUrl(owner, repo, deployment.id), { token });
    } catch {
      log("BLOCK statuses transport error.");
      return { ok: false, reason: "statuses-transport-error" };
    }
    if (!res || !res.ok || !Array.isArray(res.json)) {
      log(`BLOCK statuses rejected status=${res?.status ?? "?"}.`);
      return { ok: false, reason: `statuses-rejected-${res?.status ?? "unknown"}` };
    }
    const status = pickStatus(res.json);
    if (!status) {
      if (nowMs() >= deadline) {
        log("BLOCK timeout: deployment has no status in budget.");
        return { ok: false, reason: "timeout-no-status" };
      }
      log(`waiting (poll ${poll}): no status yet.`);
      await sleep(pollIntervalMs);
      continue;
    }
    log(`deployment=${deployment.id} state=${status.state}.`);
    if (status.state === "success") break;
    if (status.state === "pending" || status.state === "queued" || status.state === "in_progress") {
      if (nowMs() >= deadline) {
        log("BLOCK timeout: deployment never reached success in budget.");
        return { ok: false, reason: "timeout-status-pending" };
      }
      await sleep(pollIntervalMs);
      continue;
    }
    log(`BLOCK deployment state=${status.state} (failure, error or superseded).`);
    return { ok: false, reason: `deployment-${status.state}` };
  }

  const proofUrl = `${site}/_next/static/release-proof-${sha}.json`;
  const proofRes = await fetchText(proofUrl);
  if (!proofRes.ok) {
    log(`BLOCK proof unreachable status=${proofRes.status}.`);
    return { ok: false, reason: `proof-http-${proofRes.status}` };
  }
  let proof = null;
  try {
    proof = JSON.parse(proofRes.text);
  } catch {
    proof = null;
  }
  if (!proof || proof.sha !== sha || proof.releaseGate !== "mai-159-rendezvous" || proof.gate?.job?.conclusion !== "success") {
    log("BLOCK proof mismatch (SHA, gate marker or job attestation).");
    log("TRIAGE proof absent from deployment outputs means the production build never engaged the wrapper: verify Vercel System Env Vars exposure and dashboard buildCommand source (docs/DEVOPS_MIGRATIONS.md 9.4); the gate logs BYPASS/BLOCK/PROCEED in the deployment build logs.");
    return { ok: false, reason: "proof-mismatch" };
  }
  log(`proof ok for sha=${sha}.`);

  for (const path of ["/", "/sitemap.xml"]) {
    const page = await fetchText(`${site}${path}`);
    if (!page.ok) {
      log(`BLOCK smoke GET ${path} status=${page.status}.`);
      return { ok: false, reason: `smoke-${path.replace("/", "root")}-http-${page.status}` };
    }
    log(`smoke GET ${path} ok status=${page.status}.`);
  }
  log(`PASS release verified sha=${sha} deployment=${deployment.id}.`);
  return { ok: true, deploymentId: deployment.id };
}

async function main() {
  const result = await verifyRelease({
    sha: process.env.RELEASE_SHA || process.env.GITHUB_SHA || "",
    site: process.env.RELEASE_SITE || "https://meuplantao.pro",
  });
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
    console.error(`[release-smoke] BLOCKED: fatal ${error?.message || error}`);
    process.exit(1);
  });
}
