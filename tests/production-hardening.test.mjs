import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server.js";

// Exercise the actual statically declared matcher without importing auth clients.
const source = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
const matcher = JSON.parse(source.match(/matcher:\s*(\[[^\]]*\])/)[1]);

test("only the exact robots endpoint bypasses auth alongside existing static assets", () => {
  for (const url of ["/robots.txt", "/robots.txt?crawler=1", "/favicon.ico", "/_next/static/chunk.js"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url }), false, url);
  }
  for (const url of ["/", "/login", "/cadastro", "/dashboard", "/calendario", "/pagamentos", "/locais", "/contatos", "/alertas", "/historico", "/robots.txt/private", "/robotsXtxt", "/unknown"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: { matcher }, url }), true, url);
  }
});
