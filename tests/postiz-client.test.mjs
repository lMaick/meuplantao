import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLocalUrl,
  validateMediaUrl,
  pollPostStatus,
  publishOrSchedule,
  getMimeType,
  loadConfig
} from "../ops/marketing/postiz-client.mjs";

test("isLocalUrl correctly identifies local and loopback URLs", () => {
  assert.equal(isLocalUrl("http://localhost:4007/uploads/image.jpg"), true);
  assert.equal(isLocalUrl("http://127.0.0.1:4007/uploads/image.jpg"), true);
  assert.equal(isLocalUrl("http://0.0.0.0:4007/uploads/image.jpg"), true);
  assert.equal(isLocalUrl("http://app.localhost:4007/image.jpg"), true);
  assert.equal(isLocalUrl("https://pub-r2.cloudflarestorage.com/image.jpg"), false);
  assert.equal(isLocalUrl("https://media.meuplantao.pro/assets/post.jpg"), false);
  assert.equal(isLocalUrl(null), false);
  assert.equal(isLocalUrl(""), false);
});

test("validateMediaUrl rejects localhost unless explicitly allowed", () => {
  assert.throws(
    () => validateMediaUrl("http://localhost:4007/uploads/img.jpg", { allowLocal: false }),
    /A Meta\/Instagram Graph API exige URL pública HTTPS/
  );

  assert.throws(
    () => validateMediaUrl("http://127.0.0.1:4007/uploads/img.jpg"),
    /A Meta\/Instagram Graph API exige URL pública HTTPS/
  );

  assert.equal(
    validateMediaUrl("https://pub-r2.cloudflarestorage.com/img.jpg"),
    true
  );

  assert.equal(
    validateMediaUrl("http://localhost:4007/uploads/img.jpg", { allowLocal: true }),
    true
  );
});

test("getMimeType resolves correct media MIME types", () => {
  assert.equal(getMimeType("test.jpg"), "image/jpeg");
  assert.equal(getMimeType("test.jpeg"), "image/jpeg");
  assert.equal(getMimeType("test.png"), "image/png");
  assert.equal(getMimeType("test.webp"), "image/webp");
  assert.equal(getMimeType("test.mp4"), "video/mp4");
  assert.equal(getMimeType("test.bin"), "application/octet-stream");
});

test("pollPostStatus returns success when state is EXECUTED with releaseURL and releaseId", async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: true,
        json: async () => ({
          posts: [
            {
              id: "post-123",
              state: "QUEUE",
              releaseURL: null,
              releaseId: null
            }
          ]
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        posts: [
          {
            id: "post-123",
            state: "EXECUTED",
            releaseURL: "https://www.instagram.com/p/Cxyz123/",
            releaseId: "1784140001"
          }
        ]
      })
    };
  };

  const result = await pollPostStatus("post-123", {
    baseUrl: "http://mock-postiz",
    apiKey: "test-key",
    timeoutMs: 1000,
    intervalMs: 10,
    fetchFn: mockFetch
  });

  assert.equal(result.success, true);
  assert.equal(result.state, "EXECUTED");
  assert.equal(result.releaseURL, "https://www.instagram.com/p/Cxyz123/");
  assert.equal(result.releaseId, "1784140001");
});

test("pollPostStatus throws explicit error when post enters state ERROR", async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      posts: [
        {
          id: "post-fail-456",
          state: "ERROR",
          releaseURL: null,
          releaseId: null
        }
      ]
    })
  });

  await assert.rejects(
    () => pollPostStatus("post-fail-456", {
      baseUrl: "http://mock-postiz",
      apiKey: "test-key",
      timeoutMs: 500,
      intervalMs: 10,
      fetchFn: mockFetch
    }),
    /Falha na publicação do Postiz: o post "post-fail-456" entrou em estado ERROR/
  );
});

test("pollPostStatus throws explicit timeout when post remains in QUEUE past timeoutMs", async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      posts: [
        {
          id: "post-stuck-789",
          state: "QUEUE",
          releaseURL: null,
          releaseId: null
        }
      ]
    })
  });

  await assert.rejects(
    () => pollPostStatus("post-stuck-789", {
      baseUrl: "http://mock-postiz",
      apiKey: "test-key",
      timeoutMs: 50,
      intervalMs: 10,
      fetchFn: mockFetch
    }),
    /Timeout \(50ms\) aguardando processamento final do Postiz/
  );
});

test("publishOrSchedule handles schedule mode without waiting for immediate execution", async () => {
  const mockFetch = async (url, opts) => {
    if (url.includes("/api/public/v1/posts")) {
      return {
        ok: true,
        json: async () => ({
          id: "scheduled-post-001",
          type: "schedule"
        })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await publishOrSchedule({
    caption: "Post de teste agendado",
    date: "2026-09-25T15:00:00.000Z",
    integrationId: "integration-001",
    baseUrl: "http://mock-postiz",
    apiKey: "test-key",
    fetchFn: mockFetch
  });

  assert.equal(result.success, true);
  assert.equal(result.type, "schedule");
  assert.equal(result.postId, "scheduled-post-001");
});
