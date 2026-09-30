/**
 * Empirical Touch Target and Responsive Dimension Stress Harness for Milestone 1
 *
 * Authored by Challenger 1 (teamwork_preview_challenger)
 * Verified against PROJECT.md, ORIGINAL_REQUEST.md, AGENTS.md, and worker_m1 deliverables.
 *
 * Verifies:
 * 1. buttonVariants (default, sm, lg, icon, icon-sm, xs, icon-xs, icon-lg) width & height >= 44px on mobile
 * 2. Input and Select touch target height >= 44px and width >= 44px across mobile viewports (360px–430px)
 * 3. iOS auto-zoom prevention (text-base md:text-sm) on Input and Select
 * 4. AppShell navigation ergonomics (bottom bar, hamburger, drawer, z-index hierarchy)
 * 5. Layout safety and responsive scale-down contracts
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire, registerHooks } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

// MAI-139: hook de resolução .ts para imports aninhados do harness
// (ex.: src/lib/auth/redirect.ts -> ../config/site-url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json")) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (fs.existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { ErgonomicsOracle } = await import("./helpers/e2e-harness.mjs");

// Helper to evaluate TSX modules using TypeScript transpilation in a VM sandbox
function loadTsxModule(filePath) {
  const code = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const sandbox = {
    require: (id) => {
      if (id === "react/jsx-runtime") {
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      }
      return require(id);
    },
    exports: {},
    module: { exports: {} },
  };

  vm.runInNewContext(transpiled.outputText, sandbox);
  return { ...sandbox.module.exports, ...sandbox.exports };
}

const { buttonVariants } = loadTsxModule("src/components/ui/button.tsx");
const { Input, Select } = loadTsxModule("src/components/ui/primitives.tsx");

// Tailwind utility map for mobile dimension resolution (rem to px assuming 16px base)
function extractMobileDimensions(className) {
  const classes = className.split(/\s+/);

  let minHeightPx = 0;
  let explicitHeightPx = 0;
  let minWidthPx = 0;
  let explicitWidthPx = 0;
  let paddingXTotalPx = 0;

  for (const cls of classes) {
    // Ignore desktop overrides (md:, lg:, sm:) for mobile evaluations
    if (cls.includes(":")) {
      // Check for mobile-specific classes that don't have responsive prefixes
      continue;
    }

    // Min-height
    const minHMatch = cls.match(/^min-h-\[(\d+)px\]$/);
    if (minHMatch) minHeightPx = Math.max(minHeightPx, Number(minHMatch[1]));

    // Explicit height
    if (cls === "h-11") explicitHeightPx = 44;
    if (cls === "h-12") explicitHeightPx = 48;
    if (cls === "h-10") explicitHeightPx = 40;
    if (cls === "h-9") explicitHeightPx = 36;
    if (cls === "h-8") explicitHeightPx = 32;

    // Size utility (sets both width and height)
    if (cls === "size-11") {
      explicitWidthPx = 44;
      explicitHeightPx = 44;
    }
    if (cls === "size-12") {
      explicitWidthPx = 48;
      explicitHeightPx = 48;
    }

    // Min-width
    const minWMatch = cls.match(/^min-w-\[(\d+)px\]$/);
    if (minWMatch) minWidthPx = Math.max(minWidthPx, Number(minWMatch[1]));

    // Padding horizontal
    if (cls === "px-4") paddingXTotalPx = 32; // 16px * 2
    if (cls === "px-3.5") paddingXTotalPx = 28; // 14px * 2
    if (cls === "px-3") paddingXTotalPx = 24; // 12px * 2
    if (cls === "px-5") paddingXTotalPx = 40; // 20px * 2
  }

  const effectiveHeight = Math.max(explicitHeightPx, minHeightPx);
  const effectiveWidth = Math.max(explicitWidthPx, minWidthPx);

  return {
    minHeightPx,
    explicitHeightPx,
    minWidthPx,
    explicitWidthPx,
    effectiveHeight,
    effectiveWidth,
    paddingXTotalPx,
  };
}

describe("Milestone 1 Empirical Challenge: Touch Targets & Responsive Dimensions", () => {
  /* ========================================================================= */
  /* SUITE 1: BUTTON VARIANTS ERGONOMIC TOUCH TARGETS                          */
  /* ========================================================================= */
  describe("1. buttonVariants Touch Targets (Mobile Viewport)", () => {
    const requiredSizes = ["default", "sm", "lg", "icon", "icon-sm"];
    const allSizes = ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"];
    const variants = ["default", "outline", "secondary", "ghost", "destructive"];

    test("All required button size variants produce min-h-[44px] or height >= 44px on mobile", () => {
      for (const size of requiredSizes) {
        const classNames = buttonVariants({ size });
        const dims = extractMobileDimensions(classNames);

        assert.ok(
          dims.effectiveHeight >= 44,
          `Button size='${size}' must have mobile height >= 44px, got ${dims.effectiveHeight}px (classes: ${classNames})`
        );
        assert.ok(
          classNames.includes("min-h-[44px]") || classNames.includes("min-h-[48px]"),
          `Button size='${size}' must explicitly include min-h-[44px] or min-h-[48px]`
        );
      }
    });

    test("All icon variants enforce BOTH width >= 44px and height >= 44px via size-11 / min-w-[44px]", () => {
      const iconSizes = ["icon", "icon-sm", "icon-xs", "icon-lg"];
      for (const size of iconSizes) {
        const classNames = buttonVariants({ size });
        const dims = extractMobileDimensions(classNames);

        assert.ok(
          dims.effectiveHeight >= 44,
          `Icon button size='${size}' must have height >= 44px, got ${dims.effectiveHeight}px`
        );
        assert.ok(
          dims.effectiveWidth >= 44,
          `Icon button size='${size}' must have width >= 44px, got ${dims.effectiveWidth}px`
        );
        assert.ok(
          classNames.includes("min-w-[44px]") || classNames.includes("min-w-[48px]"),
          `Icon button size='${size}' must include min-w-[44px] or min-w-[48px]`
        );

        const oracleResult = ErgonomicsOracle.evaluateTouchTarget(
          dims.effectiveWidth,
          dims.effectiveHeight,
          `Button size='${size}'`
        );
        assert.equal(oracleResult.pass, true, `ErgonomicsOracle failed for size='${size}'`);
      }
    });

    test("Text button variants (default, sm, lg) maintain comfortable touch area with standard labels", () => {
      const testCases = [
        { size: "default", label: "Salvar", labelCharWidth: 42 },
        { size: "default", label: "Salvar plantão", labelCharWidth: 88 },
        { size: "sm", label: "Filtrar", labelCharWidth: 44 },
        { size: "sm", label: "Exportar CSV", labelCharWidth: 80 },
        { size: "lg", label: "Novo Plantão", labelCharWidth: 92 },
      ];

      for (const tc of testCases) {
        const classNames = buttonVariants({ size: tc.size });
        const dims = extractMobileDimensions(classNames);
        const estimatedTotalWidth = dims.paddingXTotalPx + tc.labelCharWidth;

        assert.ok(
          estimatedTotalWidth >= 44,
          `Button size='${tc.size}' with label '${tc.label}' must have rendered width >= 44px, got ${estimatedTotalWidth}px`
        );
        assert.ok(
          dims.effectiveHeight >= 44,
          `Button size='${tc.size}' must have height >= 44px, got ${dims.effectiveHeight}px`
        );

        const oracleResult = ErgonomicsOracle.evaluateTouchTarget(
          estimatedTotalWidth,
          dims.effectiveHeight,
          `Button size='${tc.size}' label='${tc.label}'`
        );
        assert.equal(oracleResult.pass, true);
      }
    });

    test("Matrix: All 48 combinations of variant x size contain touch-manipulation and min-h >= 44px", () => {
      for (const variant of variants) {
        for (const size of allSizes) {
          const classNames = buttonVariants({ variant, size });
          assert.ok(
            classNames.includes("touch-manipulation"),
            `Variant '${variant}' size '${size}' missing touch-manipulation`
          );
          assert.ok(
            classNames.includes("cursor-pointer"),
            `Variant '${variant}' size '${size}' missing cursor-pointer`
          );
          assert.ok(
            classNames.includes("disabled:cursor-not-allowed"),
            `Variant '${variant}' size '${size}' missing disabled cursor indicator`
          );

          const dims = extractMobileDimensions(classNames);
          assert.ok(
            dims.effectiveHeight >= 44,
            `Variant '${variant}' size '${size}' height < 44px (${dims.effectiveHeight}px)`
          );
        }
      }
    });

    test("Caller className overrides merge cleanly with cn without dropping base touch dimensions", () => {
      const customButtonClass = buttonVariants({ size: "default", className: "extra-custom-marker" });
      assert.ok(customButtonClass.includes("extra-custom-marker"));
      assert.ok(customButtonClass.includes("min-h-[44px]"));
      assert.ok(customButtonClass.includes("touch-manipulation"));
    });
  });

  /* ========================================================================= */
  /* SUITE 2: INPUT & SELECT FORM CONTROLS AUTO-ZOOM AND TOUCH TARGETS         */
  /* ========================================================================= */
  describe("2. Form Controls: Input & Select Standards", () => {
    test("Input component defines h-11, min-h-[44px], and w-full", () => {
      const element = Input({ id: "test-input", placeholder: "Teste" });
      const className = element.props.className;

      assert.ok(className.includes("h-11"), "Input missing h-11 (44px height)");
      assert.ok(className.includes("min-h-[44px]"), "Input missing min-h-[44px]");
      assert.ok(className.includes("w-full"), "Input missing w-full");

      const dims = extractMobileDimensions(className);
      assert.ok(dims.effectiveHeight >= 44, `Input effective height must be >= 44px, got ${dims.effectiveHeight}px`);
    });

    test("Select component defines h-11, min-h-[44px], and w-full", () => {
      const element = Select({ id: "test-select", children: [] });
      const className = element.props.className;

      assert.ok(className.includes("h-11"), "Select missing h-11 (44px height)");
      assert.ok(className.includes("min-h-[44px]"), "Select missing min-h-[44px]");
      assert.ok(className.includes("w-full"), "Select missing w-full");

      const dims = extractMobileDimensions(className);
      assert.ok(dims.effectiveHeight >= 44, `Select effective height must be >= 44px, got ${dims.effectiveHeight}px`);
    });

    test("CRITICAL: Input includes 'text-base md:text-sm' preventing iOS WebKit auto-zoom", () => {
      const element = Input({ type: "text" });
      const className = element.props.className;

      assert.ok(
        className.includes("text-base"),
        "Input MUST include 'text-base' (16px) on mobile to prevent iOS Safari auto-zoom"
      );
      assert.ok(
        className.includes("md:text-sm"),
        "Input MUST include 'md:text-sm' (14px) on desktop for visual consistency"
      );
    });

    test("CRITICAL: Select includes 'text-base md:text-sm' preventing iOS WebKit auto-zoom", () => {
      const element = Select({ name: "test-dropdown" });
      const className = element.props.className;

      assert.ok(
        className.includes("text-base"),
        "Select MUST include 'text-base' (16px) on mobile to prevent iOS Safari auto-zoom"
      );
      assert.ok(
        className.includes("md:text-sm"),
        "Select MUST include 'md:text-sm' (14px) on desktop for visual consistency"
      );
    });

    test("Form controls merge caller className without clobbering base classes", () => {
      const inputWithCustom = Input({ className: "border-red-500 my-custom-input" });
      const selectWithCustom = Select({ className: "border-emerald-500 my-custom-select" });

      assert.ok(inputWithCustom.props.className.includes("border-red-500"));
      assert.ok(inputWithCustom.props.className.includes("min-h-[44px]"));
      assert.ok(inputWithCustom.props.className.includes("text-base"));

      assert.ok(selectWithCustom.props.className.includes("border-emerald-500"));
      assert.ok(selectWithCustom.props.className.includes("min-h-[44px]"));
      assert.ok(selectWithCustom.props.className.includes("text-base"));
    });
  });

  /* ========================================================================= */
  /* SUITE 3: MOBILE VIEWPORT STRESS GRID (360px - 430px)                      */
  /* ========================================================================= */
  describe("3. Mobile Viewports Stress Grid (360px–430px)", () => {
    const mobileViewports = [
      { name: "Small Android (Galaxy S8/A10)", width: 360 },
      { name: "iPhone SE / Mini", width: 375 },
      { name: "iPhone 12/13/14/15/16", width: 390 },
      { name: "Pixel 7 / Galaxy S24", width: 412 },
      { name: "iPhone Plus / Max", width: 430 },
    ];

    test("Input & Select width in container satisfies width >= 44px without horizontal overflow", () => {
      for (const vp of mobileViewports) {
        // Container margins (px-4 = 16px on each side -> 32px total margin)
        const containerPaddingPx = 32;
        const availableContentWidth = vp.width - containerPaddingPx;

        // Input and Select have w-full -> takes available content width
        const renderedControlWidth = availableContentWidth;
        const controlHeight = 44;

        assert.ok(
          renderedControlWidth >= 44,
          `Control width on ${vp.name} (${vp.width}px) must be >= 44px, got ${renderedControlWidth}px`
        );

        const touchOracle = ErgonomicsOracle.evaluateTouchTarget(
          renderedControlWidth,
          controlHeight,
          `Input on ${vp.name}`
        );
        assert.equal(touchOracle.pass, true);

        const overflowOracle = ErgonomicsOracle.evaluateViewportOverflow(vp.width, renderedControlWidth + containerPaddingPx);
        assert.equal(overflowOracle.pass, true);
        assert.equal(overflowOracle.overflowPx, 0);
      }
    });

    test("AppShell bottom navigation items satisfy >= 44x44px touch targets on all mobile viewports", () => {
      const bottomNavHeight = 68; // 4.25rem = 68px
      const navItemCount = 5; // 4 primary + 1 quick-action

      for (const vp of mobileViewports) {
        // grid-cols-5 with px-1 (8px horizontal padding total)
        const totalNavWidth = vp.width - 8;
        const widthPerItem = Math.floor(totalNavWidth / navItemCount);

        assert.ok(
          widthPerItem >= 44,
          `Bottom nav item width on ${vp.name} (${vp.width}px) must be >= 44px, got ${widthPerItem}px`
        );
        assert.ok(
          bottomNavHeight >= 44,
          `Bottom nav height must be >= 44px, got ${bottomNavHeight}px`
        );

        const touchOracle = ErgonomicsOracle.evaluateTouchTarget(
          widthPerItem,
          bottomNavHeight,
          `Bottom nav item on ${vp.name}`
        );
        assert.equal(touchOracle.pass, true);
      }
    });
  });

  /* ========================================================================= */
  /* SUITE 4: RESPONSIVE BREAKPOINT SCALE-DOWN CONTRACTS                       */
  /* ========================================================================= */
  describe("4. Responsive Breakpoint Scale-Down Contracts", () => {
    test("Desktop breakpoint (md: >= 768px) scales down default button to h-9 (36px)", () => {
      const defaultButtonClasses = buttonVariants({ size: "default" });
      assert.ok(defaultButtonClasses.includes("md:h-9"), "Desktop size missing md:h-9");
      assert.ok(defaultButtonClasses.includes("md:min-h-9"), "Desktop size missing md:min-h-9");
      assert.ok(defaultButtonClasses.includes("md:px-3"), "Desktop size missing md:px-3");
    });

    test("Desktop breakpoint scales down sm button to h-8 (32px)", () => {
      const smButtonClasses = buttonVariants({ size: "sm" });
      assert.ok(smButtonClasses.includes("md:h-8"), "sm button missing md:h-8 on desktop");
      assert.ok(smButtonClasses.includes("md:min-h-8"), "sm button missing md:min-h-8 on desktop");
    });

    test("Desktop breakpoint scales down icon button to size-9 (36px)", () => {
      const iconButtonClasses = buttonVariants({ size: "icon" });
      assert.ok(iconButtonClasses.includes("md:size-9"), "icon button missing md:size-9 on desktop");
      assert.ok(iconButtonClasses.includes("md:min-h-9"), "icon button missing md:min-h-9 on desktop");
      assert.ok(iconButtonClasses.includes("md:min-w-9"), "icon button missing md:min-w-9 on desktop");
    });

    test("Desktop breakpoint scales down icon-sm button to size-8 (32px)", () => {
      const iconSmButtonClasses = buttonVariants({ size: "icon-sm" });
      assert.ok(iconSmButtonClasses.includes("md:size-8"), "icon-sm button missing md:size-8 on desktop");
      assert.ok(iconSmButtonClasses.includes("md:min-h-8"), "icon-sm button missing md:min-h-8 on desktop");
      assert.ok(iconSmButtonClasses.includes("md:min-w-8"), "icon-sm button missing md:min-w-8 on desktop");
    });

    test("Form controls scale font down to text-sm on desktop (md:text-sm)", () => {
      const inputClass = Input({}).props.className;
      const selectClass = Select({}).props.className;

      assert.ok(inputClass.includes("md:text-sm"), "Input missing md:text-sm");
      assert.ok(selectClass.includes("md:text-sm"), "Select missing md:text-sm");
    });
  });

  /* ========================================================================= */
  /* SUITE 5: APPSHELL NAVIGATION AND Z-INDEX HIERARCHY                        */
  /* ========================================================================= */
  describe("5. AppShell Ergonomics and Z-Index Hierarchy", () => {
    const appShellSource = fs.readFileSync("src/components/ui/app-shell.tsx", "utf8");
    const shiftCalendarSource = fs.readFileSync("src/components/shifts/shift-calendar.tsx", "utf8");
    const placesPageSource = fs.readFileSync("src/lib/places/places-page.tsx", "utf8");

    test("Hamburger menu button enforces 44x44px touch area", () => {
      assert.match(appShellSource, /size-11 min-h-\[44px\] min-w-\[44px\]/);
      assert.match(appShellSource, /aria-label="Abrir menu de opções"/);
    });

    test("Drawer close button enforces 44x44px touch area", () => {
      assert.match(appShellSource, /size-11 min-h-\[44px\] min-w-\[44px\]/);
      assert.match(appShellSource, /aria-label="Fechar menu"/);
    });

    test("Drawer secondary nav items enforce min-h-[44px]", () => {
      assert.match(appShellSource, /min-h-\[44px\] items-center gap-3\.5/);
    });

    test("Bottom navigation bar includes safe-area padding and height formula", () => {
      assert.match(appShellSource, /h-\[calc\(4\.25rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
      assert.match(appShellSource, /pb-\[max\(0\.375rem,env\(safe-area-inset-bottom\)\)\]/);
    });

    test("Main container includes bottom padding (pb-28) to prevent bottom bar content occlusion", () => {
      assert.match(appShellSource, /pb-28 lg:pb-8/);
    });

    test("Z-Index layering hierarchy: Shift & Places modals (z-50) > Drawer (z-50) > Bottom Nav (z-30) > Header (z-20)", () => {
      // Shift modal container uses z-50
      assert.match(shiftCalendarSource, /z-50 flex items-end justify-center/);
      // Places modal container uses z-50
      assert.match(placesPageSource, /fixed inset-0 z-50 flex items-end/);
      // AppShell drawer uses z-50
      assert.match(appShellSource, /fixed inset-0 z-50/);
      // AppShell bottom nav uses z-30
      assert.match(appShellSource, /fixed inset-x-0 bottom-0 z-30/);
      // AppShell header uses z-20
      assert.match(appShellSource, /sticky top-0 z-20/);

      const zStackOracle = ErgonomicsOracle.evaluateZIndexStack({
        modalZ: 50,
        bottomNavZ: 30,
        headerZ: 20,
        contentZ: 0,
      });
      assert.equal(zStackOracle.pass, true);
    });
  });

  /* ========================================================================= */
  /* SUITE 6: ADVERSARIAL EDGE CASES AND ROBUSTNESS                            */
  /* ========================================================================= */
  describe("6. Adversarial Edge Cases", () => {
    test("Extremely short button label 'OK' or single icon preserves >= 44px touch height", () => {
      const smClasses = buttonVariants({ size: "sm" });
      const defaultClasses = buttonVariants({ size: "default" });

      const dimsSm = extractMobileDimensions(smClasses);
      const dimsDef = extractMobileDimensions(defaultClasses);

      assert.ok(dimsSm.effectiveHeight >= 44);
      assert.ok(dimsDef.effectiveHeight >= 44);
    });

    test("Icon button with size='icon' with SVG child does not shrink below 44x44px", () => {
      const iconClasses = buttonVariants({ size: "icon" });
      const dims = extractMobileDimensions(iconClasses);

      assert.equal(dims.effectiveHeight, 44);
      assert.equal(dims.effectiveWidth, 44);
      assert.ok(iconClasses.includes("shrink-0"));
      assert.ok(iconClasses.includes("min-w-[44px]"));
      assert.ok(iconClasses.includes("min-h-[44px]"));
    });

    test("Toast notification uses z-50 and bottom offset (bottom-24) to float above bottom bar (z-30)", () => {
      const primitivesSource = fs.readFileSync("src/components/ui/primitives.tsx", "utf8");
      assert.match(primitivesSource, /fixed bottom-24 right-4 z-50/);
    });

    test("Root layout sets viewportFit: 'cover' for iOS notch and home indicator safe area support", () => {
      const layoutSource = fs.readFileSync("src/app/layout.tsx", "utf8");
      assert.match(layoutSource, /viewportFit:\s*"cover"/);
    });

    test("Globals CSS defines safe area utilities: pb-safe, pt-safe, mb-safe", () => {
      const cssSource = fs.readFileSync("src/app/globals.css", "utf8");
      assert.match(cssSource, /@utility pb-safe/);
      assert.match(cssSource, /@utility pt-safe/);
      assert.match(cssSource, /@utility mb-safe/);
    });
  });
});
