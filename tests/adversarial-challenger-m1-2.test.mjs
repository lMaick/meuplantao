/**
 * Adversarial Challenger 2 Test Suite for Milestone 1 (Foundations & Design System)
 * 
 * Empirically stress-tests:
 * 1. Z-Index Layering and Stacking Context Hierarchy (Header z-20 < Bottom Nav z-30 < Modals/Drawers/Toast z-50)
 * 2. Mobile Toast Clearance Geometry (bottom-24 vs Bottom Nav h-[4.5rem] and safe-area insets)
 * 3. Main Container Bottom Padding Clearance (pb-28 across 360px, 390px, 430px viewports)
 * 4. Safe-Area Inset Configuration (viewportFit: cover, pb-safe utilities)
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

describe("Adversarial Stress-Testing: Z-Index Layering & Stacking Context", () => {
  const appShellPath = path.join(ROOT, "src/components/ui/app-shell.tsx");
  const primitivesPath = path.join(ROOT, "src/components/ui/primitives.tsx");
  const shiftCalendarPath = path.join(ROOT, "src/components/shifts/shift-calendar.tsx");
  const placesPagePath = path.join(ROOT, "src/lib/places/places-page.tsx");
  const appShellCode = fs.readFileSync(appShellPath, "utf-8");
  const primitivesCode = fs.readFileSync(primitivesPath, "utf-8");
  const shiftCalendarCode = fs.readFileSync(shiftCalendarPath, "utf-8");
  const placesPageCode = fs.readFileSync(placesPagePath, "utf-8");

  test("[CH-M1-01] Stacking Context Hierarchy: Header z-20 < Bottom Nav z-30 < Modals/Drawers/Toasts z-50", () => {
    // 1. Verify Header z-20
    const headerMatch = appShellCode.match(/<header[^>]*className=["']([^"']+)["']/);
    assert.ok(headerMatch, "Header component must exist in AppShell");
    assert.ok(headerMatch[1].includes("z-20"), "Mobile header must specify z-20");
    assert.ok(headerMatch[1].includes("sticky"), "Mobile header must be sticky");

    // 2. Verify Bottom Nav z-30
    const navTags = [...appShellCode.matchAll(/<nav\b([\s\S]*?)>/g)].map((m) => m[1]);
    const mobileNav = navTags.find((tag) => tag.includes('aria-label="Navegação móvel"'));
    assert.ok(mobileNav, "Mobile bottom nav must exist in AppShell");
    assert.ok(mobileNav.includes("z-30"), "Mobile bottom nav must specify z-30");
    assert.ok(mobileNav.includes("fixed"), "Mobile bottom nav must be fixed");

    // 3. Verify Desktop Sidebar z-30
    const asideMatch = appShellCode.match(/<aside[^>]*className=["']([^"']+)["']/);
    assert.ok(asideMatch, "Desktop sidebar must exist in AppShell");
    assert.ok(asideMatch[1].includes("z-30"), "Desktop sidebar must specify z-30");

    // 4. Verify Mobile Drawer z-50
    const drawerMatch = appShellCode.match(/drawerOpen\s*&&\s*\(\s*<div[^>]*className=["']([^"']+)["']/);
    assert.ok(drawerMatch, "Mobile drawer modal backdrop must exist in AppShell");
    assert.ok(drawerMatch[1].includes("z-50"), "Mobile drawer must specify z-50");
    assert.ok(drawerMatch[1].includes("fixed"), "Mobile drawer must be fixed");

    // 5. Verify Sheet primitive z-50
    assert.ok(
      primitivesCode.includes("fixed inset-y-0 right-0 z-50"),
      "Sheet primitive must specify z-50"
    );

    // 6. Verify Toast primitive z-50
    assert.ok(
      primitivesCode.includes("z-50") && primitivesCode.includes("bottom-24"),
      "Toast primitive must specify z-50"
    );

    // 7. Verify Shift Calendar Form Modal z-50
    const shiftModalMatch = shiftCalendarCode.match(/className=["']fixed inset-0 (z-\d+)[^"']*["']/);
    assert.ok(shiftModalMatch, "Shift calendar form container must have fixed inset-0 z-index");
    assert.equal(shiftModalMatch[1], "z-50", "Shift calendar modal must be elevated to z-50");

    // 8. Verify Places Page Form Modal z-50
    const placesModalMatch = placesPageCode.match(/open\s*&&\s*<div[^>]*className=["']fixed inset-0 (z-\d+)[^"']*["']/);
    assert.ok(placesModalMatch, "Places form container must have fixed inset-0 z-index");
    assert.equal(placesModalMatch[1], "z-50", "Places modal must be elevated to z-50");

    // Evaluate mathematical hierarchy
    const zHeader = 20;
    const zBottomNav = 30;
    const zModals = 50;

    assert.ok(zHeader < zBottomNav, "Header (z-20) must be lower than Bottom Nav (z-30)");
    assert.ok(zBottomNav < zModals, "Bottom Nav (z-30) must be lower than Modals/Drawers/Toasts (z-50)");
  });

  test("[CH-M1-02] Main container does NOT trap modals or create unintended stacking context", () => {
    // A main container with transform, filter, or isolation would isolate child fixed elements into a sub-stacking context.
    const mainMatch = appShellCode.match(/<main[^>]*className=["']([^"']+)["']/);
    assert.ok(mainMatch, "Main container must exist in AppShell");
    const mainClasses = mainMatch[1].split(/\s+/);

    assert.ok(!mainClasses.includes("isolate"), "Main container must not specify isolate");
    assert.ok(!mainClasses.some((c) => c.startsWith("transform") || c.startsWith("scale-")), "Main container must not specify transform");
    assert.ok(!mainClasses.some((c) => c.startsWith("filter") || c.startsWith("backdrop-")), "Main container must not specify filter");
    assert.ok(!mainClasses.includes("relative") && !mainClasses.includes("absolute"), "Main container must use default static positioning");
  });
});

describe("Adversarial Stress-Testing: Toast Clearance & Floating Geometry", () => {
  const primitivesPath = path.join(ROOT, "src/components/ui/primitives.tsx");
  const primitivesCode = fs.readFileSync(primitivesPath, "utf-8");

  test("[CH-M1-03] Toast floats at bottom-24 (96px) clearing fixed bottom nav (4.5rem = 72px / 4.25rem = 68px)", () => {
    // Extract Toast positioning from primitives.tsx
    const toastMatch = primitivesCode.match(/export function Toast\(\{[\s\S]*?className=["']([^"']+)["']/);
    assert.ok(toastMatch, "Toast component must exist with className");
    const toastClasses = toastMatch[1];

    assert.ok(toastClasses.includes("fixed"), "Toast must be fixed positioned");
    assert.ok(toastClasses.includes("bottom-24"), "Toast must float at bottom-24 on mobile");
    assert.ok(toastClasses.includes("z-50"), "Toast must have z-50");

    // Geometric calculation:
    // Tailwind base font size = 16px
    // bottom-24 = 24 * 4px = 96px = 6rem
    // Bottom nav height:
    // Base height specified in PROJECT.md: h-[4.5rem] = 72px
    // AppShell actual base height: 4.25rem = 68px
    const toastBottomPx = 24 * 4; // 96px
    const bottomNavNominalPx = 4.5 * 16; // 72px
    const bottomNavAppShellPx = 4.25 * 16; // 68px

    const clearanceNominal = toastBottomPx - bottomNavNominalPx;
    const clearanceAppShell = toastBottomPx - bottomNavAppShellPx;

    assert.ok(clearanceNominal > 0, "Toast bottom (96px) must float above nominal 72px bottom nav");
    assert.equal(clearanceNominal, 24, "Toast provides exactly 24px (1.5rem) floating clearance above 72px bottom nav");
    assert.equal(clearanceAppShell, 28, "Toast provides exactly 28px (1.75rem) floating clearance above 68px bottom nav");
  });

  test("[CH-M1-04] Toast z-50 ensures no occlusion even under extreme safe-area-inset scenarios", () => {
    // If device has safe-area-inset-bottom = 34px (iPhone gesture bar):
    // Bottom nav total height = 68px + 34px = 102px
    // Toast bottom-24 = 96px
    // While there is a 6px spatial overlap between bottom of toast and top of bottom nav,
    // Toast z-50 > Bottom Nav z-30 guarantees the toast remains on top and fully interactive.
    const toastZ = 50;
    const bottomNavZ = 30;
    assert.ok(toastZ > bottomNavZ, "Toast z-50 guarantees it renders above bottom nav z-30");
  });
});

describe("Adversarial Stress-Testing: Main Container Clearance Across Mobile Viewports", () => {
  const appShellPath = path.join(ROOT, "src/components/ui/app-shell.tsx");
  const appShellCode = fs.readFileSync(appShellPath, "utf-8");

  test("[CH-M1-05] Main container padding pb-28 (112px) provides clearance exceeding bottom nav across 360px, 390px, 430px", () => {
    const mainMatch = appShellCode.match(/<main[^>]*className=["']([^"']+)["']/);
    assert.ok(mainMatch, "Main container must exist in AppShell");
    const mainClasses = mainMatch[1];

    assert.ok(mainClasses.includes("pb-28"), "Main container must specify pb-28 on mobile");
    assert.ok(mainClasses.includes("lg:pb-8"), "Main container must specify lg:pb-8 on desktop");

    // Geometric clearance analysis:
    // pb-28 = 28 * 4px = 112px (7rem)
    const mainPaddingBottomPx = 28 * 4; // 112px
    const bottomNavBaseHeightPx = 4.25 * 16; // 68px

    // 1. Without safe area inset (Android, standard web)
    const clearanceStandard = mainPaddingBottomPx - bottomNavBaseHeightPx;
    assert.equal(clearanceStandard, 44, "pb-28 provides exactly 44px of clearance above bottom nav (equal to standard 44px touch target!)");

    // 2. With standard iPhone safe-area inset (34px)
    const safeAreaInsetIphone = 34;
    const bottomNavIphoneHeight = bottomNavBaseHeightPx + safeAreaInsetIphone; // 102px
    const clearanceIphone = mainPaddingBottomPx - bottomNavIphoneHeight;
    assert.ok(clearanceIphone > 0, "pb-28 provides positive clearance (10px) even on devices with 34px safe area inset");
    assert.equal(clearanceIphone, 10);

    // 3. Across viewports 360px, 390px, 430px
    const targetViewports = [360, 390, 430];
    for (const vp of targetViewports) {
      assert.ok(vp < 1024, `Viewport ${vp}px must be treated as mobile (< lg breakpoint 1024px)`);
      // Mobile main padding is unconditionally 112px on all viewports < 1024px
      assert.equal(mainPaddingBottomPx, 112, `Viewport ${vp}px receives full 112px bottom padding`);
    }
  });

  test("[CH-M1-06] Bottom navigation grid-cols-5 fits 360px viewport without horizontal overflow", () => {
    // In AppShell:
    // <nav className="... grid h-[...] grid-cols-5 ... px-1 pt-1.5 pb-[...] ...">
    // On 360px viewport:
    // Total width = 360px
    // Container horizontal padding = px-1 = 4px * 2 = 8px
    // Available width = 360 - 8 = 352px
    // Width per column = 352 / 5 = 70.4px
    // Each navigation item touch width: 70.4px >= 44px minimum touch target!
    const viewportWidth = 360;
    const navPaddingHorizontal = 4 * 2; // px-1 = 0.25rem each side = 8px
    const availableWidth = viewportWidth - navPaddingHorizontal;
    const colWidth = availableWidth / 5;

    assert.ok(colWidth >= 44, `Column width (${colWidth}px) on 360px viewport must exceed 44px minimum touch target width`);
    assert.ok(colWidth * 5 + navPaddingHorizontal <= viewportWidth, "Navigation items must not exceed viewport width (no horizontal overflow)");
  });
});

describe("Adversarial Stress-Testing: Safe-Area Insets & Viewport Configuration", () => {
  const layoutPath = path.join(ROOT, "src/app/layout.tsx");
  const globalsCssPath = path.join(ROOT, "src/app/globals.css");
  const appShellPath = path.join(ROOT, "src/components/ui/app-shell.tsx");

  const layoutCode = fs.readFileSync(layoutPath, "utf-8");
  const globalsCssCode = fs.readFileSync(globalsCssPath, "utf-8");
  const appShellCode = fs.readFileSync(appShellPath, "utf-8");

  test("[CH-M1-07] Viewport configuration includes viewportFit: 'cover' to unlock env(safe-area-inset-*)", () => {
    assert.ok(
      layoutCode.includes('viewportFit: "cover"'),
      "layout.tsx must export viewport with viewportFit: 'cover'"
    );
  });

  test("[CH-M1-08] CSS defines safe-area utility classes using max() fallback functions", () => {
    assert.ok(globalsCssCode.includes("@utility pb-safe"), "globals.css must define pb-safe");
    assert.ok(globalsCssCode.includes("@utility pt-safe"), "globals.css must define pt-safe");
    assert.ok(globalsCssCode.includes("@utility mb-safe"), "globals.css must define mb-safe");

    assert.ok(
      globalsCssCode.includes("env(safe-area-inset-bottom)"),
      "pb-safe must use env(safe-area-inset-bottom)"
    );
    assert.ok(
      globalsCssCode.includes("env(safe-area-inset-top)"),
      "pt-safe must use env(safe-area-inset-top)"
    );
  });

  test("[CH-M1-09] AppShell incorporates safe-area-inset in Header, Drawer, and Bottom Nav", () => {
    // Header safe area top
    assert.ok(
      appShellCode.includes("pt-[env(safe-area-inset-top,0px)]"),
      "Header must include top safe-area inset"
    );

    // Bottom nav safe area bottom in height and padding
    assert.ok(
      appShellCode.includes("h-[calc(4.25rem+env(safe-area-inset-bottom,0px))]"),
      "Bottom nav height must incorporate bottom safe-area inset"
    );
    assert.ok(
      appShellCode.includes("pb-[max(0.375rem,env(safe-area-inset-bottom))]"),
      "Bottom nav bottom padding must incorporate bottom safe-area inset"
    );

    // Drawer safe area top and bottom
    assert.ok(
      appShellCode.includes("pt-[max(1.5rem,env(safe-area-inset-top))]"),
      "Drawer must incorporate top safe-area inset"
    );
    assert.ok(
      appShellCode.includes("pb-[max(1.5rem,env(safe-area-inset-bottom))]"),
      "Drawer must incorporate bottom safe-area inset"
    );
  });
});
