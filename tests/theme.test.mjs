import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const providerSource = fs.readFileSync("src/components/theme/theme-provider.tsx", "utf8");
const utilsSource = fs.readFileSync("src/components/theme/theme-utils.ts", "utf8");
const layoutSource = fs.readFileSync("src/app/layout.tsx", "utf8");
const toggleSource = fs.readFileSync("src/components/theme/theme-toggle.tsx", "utf8");
const settingsSource = fs.readFileSync("src/app/configuracoes/page.tsx", "utf8");

test("theme provider persists all supported themes", () => {
  assert.match(utilsSource, /meuplantao:theme/);
  assert.match(providerSource, /localStorage\.getItem\(THEME_STORAGE_KEY\)/);
  assert.match(providerSource, /localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/);
  assert.match(providerSource, /storedTheme === "light" \|\| storedTheme === "dark" \|\| storedTheme === "system"/);
});

test("theme provider applies and removes the dark class", () => {
  assert.match(providerSource, /classList\.toggle\("dark", resolvedTheme === "dark"\)/);
  assert.match(providerSource, /prefers-color-scheme: dark/);
  assert.match(providerSource, /addEventListener\("change", handleSystemThemeChange\)/);
});

test("layout installs the anti-FOUC script and provider", () => {
  assert.match(layoutSource, /suppressHydrationWarning/);
  assert.match(layoutSource, /localStorage\.getItem\("meuplantao:theme"\)/);
  assert.match(layoutSource, /document\.documentElement\.classList\.toggle\("dark", resolved === "dark"\)/);
  assert.match(layoutSource, /<ThemeProvider>/);
});

test("theme toggle exposes accessible light, dark, and system controls", () => {
  assert.match(toggleSource, /Sun/);
  assert.match(toggleSource, /Moon/);
  assert.match(toggleSource, /Monitor/);
  assert.match(toggleSource, /role="radiogroup"/);
  assert.match(toggleSource, /role="radio"/);
  assert.match(toggleSource, /aria-checked=\{selected\}/);
  assert.match(settingsSource, /<ThemeToggle \/>/);
});
