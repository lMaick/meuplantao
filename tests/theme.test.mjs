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

test("getToggledTheme provides direct 1-click deterministic toggle", async () => {
  const { getToggledTheme } = await import("../src/components/theme/theme-utils.ts");
  assert.equal(getToggledTheme("dark", "dark"), "light");
  assert.equal(getToggledTheme("light", "light"), "dark");
  assert.equal(getToggledTheme("system", "dark"), "light");
  assert.equal(getToggledTheme("system", "light"), "dark");
});

test("getResolvedTheme correctly handles system and explicit themes", async () => {
  const { getResolvedTheme } = await import("../src/components/theme/theme-utils.ts");
  assert.equal(getResolvedTheme("system", "dark"), "dark");
  assert.equal(getResolvedTheme("system", "light"), "light");
  assert.equal(getResolvedTheme("dark", "light"), "dark");
  assert.equal(getResolvedTheme("light", "dark"), "light");
});

test("AppShell sidebar uses compact theme toggle and drawer omits redundant toggle", () => {
  const shellSource = fs.readFileSync("src/components/ui/app-shell.tsx", "utf8");
  // Desktop sidebar has compact toggle
  assert.match(shellSource, /<aside[\s\S]*?<ThemeToggle compact \/>[\s\S]*?<\/aside>/);
  // Desktop sidebar does NOT contain full/redundant ThemeToggle
  const asideMatch = shellSource.match(/<aside[\s\S]*?<\/aside>/);
  assert.ok(asideMatch, "Sidebar desktop must exist");
  assert.doesNotMatch(asideMatch[0], /<ThemeToggle \/>/, "Sidebar must not contain full ThemeToggle");

  // Drawer does NOT contain redundant ThemeToggle
  const drawerBlock = shellSource.match(/role="dialog"[\s\S]*?<\/div>\s*<\/div>\s*\)/);
  assert.ok(drawerBlock, "Drawer mobile deve existir");
  assert.doesNotMatch(
    drawerBlock[0],
    /<ThemeToggle/,
    "Drawer não deve conter ThemeToggle redundante"
  );
});

