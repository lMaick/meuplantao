import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCTION_CREATOR,
  verifyRelease,
} from "../scripts/verify-production-release.mjs";

const SHA = "c".repeat(40);

function text200(text) {
  return { ok: true, status: 200, text };
}

function mockSmoke({ deployments = [], statuses = [], pages = {} } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/statuses")) return { ok: true, status: 200, json: statuses };
    return { ok: true, status: 200, json: deployments };
  };
  const fetchText = async (url) => {
    calls.push(url);
    if (url in pages) return pages[url];
    return { ok: false, status: 404, text: "" };
  };
  return { fetchJson, fetchText, calls };
}

function deployment(overrides = {}) {
  return {
    id: 987654321,
    sha: SHA,
    environment: "Production",
    creator: { login: PRODUCTION_CREATOR },
    ...overrides,
  };
}

const successStatus = [{ id: 5, state: "success", environment_url: "https://meuplantao.pro" }];

function proofBody(overrides = {}) {
  return JSON.stringify({
    releaseGate: "mai-159-rendezvous",
    sha: SHA,
    event: "push",
    branch: "main",
    gate: { job: { conclusion: "success" } },
    ...overrides,
  });
}

function happyPages(overrides = {}) {
  return {
    [`https://meuplantao.pro/_next/static/release-proof-${SHA}.json`]: text200(proofBody()),
    "https://meuplantao.pro/": text200("<html>home</html>"),
    "https://meuplantao.pro/sitemap.xml": text200("<urlset/>"),
    ...overrides,
  };
}

function captureLogger() {
  const lines = [];
  return { logger: { log: (m) => lines.push(String(m)) }, lines };
}

async function runSmoke(overrides = {}, mocks = {}) {
  const { logger, lines } = captureLogger();
  const { fetchJson, fetchText, calls } = mockSmoke(mocks);
  const result = await verifyRelease({
    owner: "lMaick",
    repo: "meuplantao",
    sha: SHA,
    site: "https://meuplantao.pro",
    logger,
    timeoutMs: 60_000,
    pollIntervalMs: 5_000,
    fetchJson: overrides.fetchJson || fetchJson,
    fetchText: overrides.fetchText || fetchText,
    ...overrides,
  });
  return { result, lines, calls };
}

test("happy path verifies deployment, proof and public pages", async () => {
  const { result } = await runSmoke(
    {},
    { deployments: [deployment()], statuses: successStatus, pages: happyPages() },
  );
  assert.equal(result.ok, true);
  assert.equal(result.deploymentId, 987654321);
});

test("proof is verified before any page success is accepted (order pinned)", async () => {
  const { result, calls } = await runSmoke(
    {},
    { deployments: [deployment()], statuses: successStatus, pages: happyPages() },
  );
  assert.equal(result.ok, true);
  const proofIdx = calls.findIndex((u) => u.includes("release-proof-"));
  const homeIdx = calls.findIndex((u) => u === "https://meuplantao.pro/");
  const mapIdx = calls.findIndex((u) => u === "https://meuplantao.pro/sitemap.xml");
  assert.ok(proofIdx !== -1 && homeIdx !== -1 && mapIdx !== -1, "all fetches must happen");
  assert.ok(proofIdx < homeIdx && proofIdx < mapIdx, "page success must never precede proof verification");
});

test("failed deployment blocks", async () => {
  const { result } = await runSmoke(
    {},
    { deployments: [deployment()], statuses: [{ id: 6, state: "failure" }], pages: happyPages() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "deployment-failure");
});

test("superseded (inactive) deployment blocks", async () => {
  const { result } = await runSmoke(
    {},
    { deployments: [deployment()], statuses: [{ id: 6, state: "inactive" }], pages: happyPages() },
  );
  assert.equal(result.ok, false);
});

test("non-vercel creator deployments are ignored and time out", async () => {
  const { result } = await runSmoke(
    { timeoutMs: 1, pollIntervalMs: 1 },
    { deployments: [deployment({ creator: { login: "someone-else" } })], statuses: successStatus },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout-no-deployment");
});

test("wrong-SHA deployments are ignored", async () => {
  const { result } = await runSmoke(
    { timeoutMs: 1, pollIntervalMs: 1 },
    { deployments: [deployment({ sha: "d".repeat(40) })], statuses: successStatus },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout-no-deployment");
});

test("proof with wrong SHA blocks", async () => {
  const { result } = await runSmoke(
    {},
    {
      deployments: [deployment()],
      statuses: successStatus,
      pages: happyPages({
        [`https://meuplantao.pro/_next/static/release-proof-${SHA}.json`]: text200(proofBody({ sha: "e".repeat(40) })),
      }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "proof-mismatch");
});

test("unreachable or malformed proof blocks", async () => {
  for (const page of [{ ok: false, status: 404, text: "" }, text200("not-json{{{")]) {
    const { result } = await runSmoke(
      {},
      {
        deployments: [deployment()],
        statuses: successStatus,
        pages: happyPages({
          [`https://meuplantao.pro/_next/static/release-proof-${SHA}.json`]: page,
        }),
      },
    );
    assert.equal(result.ok, false, JSON.stringify(page).slice(0, 40));
  }
});

test("failing public page blocks (home and sitemap)", async () => {
  const badHome = await runSmoke(
    {},
    {
      deployments: [deployment()],
      statuses: successStatus,
      pages: happyPages({ "https://meuplantao.pro/": { ok: false, status: 500, text: "" } }),
    },
  );
  assert.equal(badHome.result.ok, false);
  assert.match(badHome.result.reason, /smoke-root-http-500/);

  const badMap = await runSmoke(
    {},
    {
      deployments: [deployment()],
      statuses: successStatus,
      pages: happyPages({ "https://meuplantao.pro/sitemap.xml": { ok: false, status: 404, text: "" } }),
    },
  );
  assert.equal(badMap.result.ok, false);
});

test("pending deployment becomes success across polls", async () => {
  let statusCalls = 0;
  const { logger } = captureLogger();
  const { fetchText } = mockSmoke({ pages: happyPages() });
  const result = await verifyRelease({
    sha: SHA,
    logger,
    timeoutMs: 60_000,
    pollIntervalMs: 1_000,
    fetchText,
    fetchJson: async (url) => {
      if (url.includes("/statuses")) {
        statusCalls += 1;
        return { ok: true, status: 200, json: statusCalls < 2 ? [{ id: 4, state: "pending" }] : successStatus };
      }
      return { ok: true, status: 200, json: [deployment()] };
    },
  });
  assert.equal(result.ok, true);
});

test("invalid SHA blocks before any network call", async () => {
  let called = 0;
  const { logger } = captureLogger();
  const result = await verifyRelease({
    sha: "nope",
    logger,
    fetchJson: async () => {
      called += 1;
      return { ok: true, status: 200, json: [] };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid-sha");
  assert.equal(called, 0);
});

test("rejected deployments API blocks; token and bodies never logged", async () => {
  const token = "SECRET-SMOKE-TOKEN-999";
  const { logger, lines } = captureLogger();
  const result = await verifyRelease({
    sha: SHA,
    logger,
    token,
    fetchJson: async () => ({ ok: false, status: 403, json: { message: "SECRET-BODY-MARKER rate limited" } }),
  });
  assert.equal(result.ok, false);
  const logged = lines.join("\n");
  assert.ok(!logged.includes(token), "token must never appear in logs");
  assert.ok(!logged.includes("SECRET-BODY-MARKER"), "response bodies must never be logged");
});
