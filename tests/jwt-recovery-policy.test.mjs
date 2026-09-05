import assert from "node:assert/strict";
import { test } from "node:test";
import { createJwtRecovery, isInvalidJwtError } from "../src/lib/auth/jwt-recovery.ts";

test("matches JWT failures without treating every authentication or database error as an invalid session", () => {
  for (const error of [
    { code: "bad_jwt" }, { code: "PGRST301" }, { code: "PGRST303" },
    { message: "JWT issued at future" }, { message: "JWT issued in the future" },
    { message: "invalid JWT" }, { message: "JWT expired" }, { message: "JWT is not yet valid" },
  ]) assert.equal(isInvalidJwtError(error), true, JSON.stringify(error));
  for (const error of [
    null, undefined, "JWT expired", {}, { message: 123 },
    { status: 401, message: "Invalid login credentials" },
    { code: "PGRST302", message: "Anonymous access disabled" },
    { code: "42501", message: "permission denied" },
    { code: "23514", message: "invalid payment" }, new Error("Failed to fetch"),
  ]) assert.equal(isInvalidJwtError(error), false, JSON.stringify(error));
});

test("waits for session cleanup before navigation and coalesces concurrent errors", async () => {
  let finish;
  let count = 0;
  const redirects = [];
  const recover = createJwtRecovery(() => {
    count++;
    return new Promise((resolve) => { finish = resolve; });
  }, { pathname: "/pagamentos", replace: (url) => redirects.push(url) });
  assert.equal(await recover({ message: "network unavailable" }), false);
  const calls = [recover({ message: "invalid JWT" }), recover({ code: "PGRST301" })];
  await Promise.resolve();
  assert.equal(count, 1);
  assert.deepEqual(redirects, []);
  finish({ error: null });
  assert.deepEqual(await Promise.all(calls), [true, true]);
  await recover({ code: "bad_jwt" });
  assert.equal(count, 1);
  assert.deepEqual(redirects, ["/login?reason=session-expired"]);
});

test("does not reload the login page, and failed cleanup allows a deliberate retry", async () => {
  let calls = 0;
  const recover = createJwtRecovery(async () => {
    calls++;
    return { error: calls === 1 ? new Error("offline") : null };
  }, { pathname: "/login", replace: () => assert.fail("login loop") });
  await assert.rejects(recover({ code: "bad_jwt" }), /Tente novamente/);
  assert.equal(await recover({ code: "bad_jwt" }), true);
  assert.equal(calls, 2);
});
