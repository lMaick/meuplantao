import assert from "node:assert/strict";
import { after, test } from "node:test";
import { getSupabaseConfig, requireSupabaseConfig } from "../src/lib/supabase/config.ts";

const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const original = names.map((name) => process.env[name]);
after(() => names.forEach((name, index) => {
  if (original[index] === undefined) delete process.env[name];
  else process.env[name] = original[index];
}));

test("missing, blank, malformed and example configuration fails closed", () => {
  for (const [url, key] of [
    [undefined, undefined], ["http://localhost:54321", undefined],
    [undefined, "test-key"], ["  ", "test-key"],
    ["invalid", "test-key"], ["file:///tmp/test", "test-key"],
    ["https://your-project.supabase.co", "your-anon-key"],
    ["http://localhost:54321", "your-anon-key"],
    ["http://localhost:54321", " "],
  ]) {
    names.forEach((name, index) => {
      const value = [url, key][index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    assert.equal(getSupabaseConfig(), null);
    assert.throws(requireSupabaseConfig, /\.env\.local/);
  }
});

test("configured environments return trimmed values without network access", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = " http://localhost:54321 ";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = " test-key ";
  assert.deepEqual(requireSupabaseConfig(), { url: "http://localhost:54321", key: "test-key" });
});

test("configuration errors never echo supplied values", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "invalid-private-value";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "private-key-value";
  assert.throws(requireSupabaseConfig, (error) => {
    assert.equal(error.message.includes("invalid-private-value"), false);
    assert.equal(error.message.includes("private-key-value"), false);
    return true;
  });
});
