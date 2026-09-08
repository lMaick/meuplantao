import assert from "node:assert/strict";
import test from "node:test";
import { logoutAndRedirect } from "../src/lib/auth/logout.ts";

test("logout redirects only after Supabase confirms signOut", async () => {
  const redirects = [];
  const result = await logoutAndRedirect(async () => ({ error: null }), (path) => redirects.push(path));
  assert.equal(result, true);
  assert.deepEqual(redirects, ["/login"]);
});

test("logout failure does not redirect or claim success", async () => {
  const redirects = [];
  const result = await logoutAndRedirect(async () => ({ error: new Error("internal detail") }), (path) => redirects.push(path));
  assert.equal(result, false);
  assert.deepEqual(redirects, []);
});

test("logout exception does not redirect", async () => {
  const redirects = [];
  const result = await logoutAndRedirect(async () => { throw new Error("network detail"); }, (path) => redirects.push(path));
  assert.equal(result, false);
  assert.deepEqual(redirects, []);
});
