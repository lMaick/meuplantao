import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return {
        url: "data:text/javascript,export const createServerClient = (_url, _key, options) => ({ auth: { getUser: async () => { globalThis.__twaTestGetUserCalls = (globalThis.__twaTestGetUserCalls || 0) + 1; void options; return { data: { user: globalThis.__twaTestMockUser || null }, error: null }; } } });",
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const url = fs.existsSync(new URL(`${base.href}.ts`))
        ? `${base.href}.ts`
        : `${base.href}/index.ts`;
      return nextResolve(url, context);
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !specifier.endsWith(".ts") &&
      !specifier.endsWith(".js") &&
      !specifier.endsWith(".mjs") &&
      !specifier.endsWith(".json")
    ) {
      const parentUrl = context.parentURL ? new URL(context.parentURL) : new URL(import.meta.url);
      const resolved = new URL(specifier, parentUrl);
      if (fs.existsSync(new URL(`${resolved.href}.ts`))) {
        return nextResolve(`${resolved.href}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const { NextRequest } = await import("next/server.js");
const manifestModule = await import("../src/app/manifest.ts");
const {
  ANDROID_PACKAGE_NAME,
  TWA_COOKIE_NAME,
  TWA_QUERY_PARAM,
  TWA_QUERY_VALUE,
  buildTwaBootstrapScript,
  isAndroidTwaReferrer,
  isTwaContext,
  parseCookieValue,
  resolveTwaOriginParam,
} = await import("../src/lib/twa/index.ts");
const { middleware } = await import("../src/middleware.ts");
const { calculateTrial, canCreateShift } = await import("../src/lib/subscription/trial.ts");

function readPngDimensions(absPath) {
  const buf = fs.readFileSync(absPath);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.subarray(0, 8).equals(pngSignature), `${absPath} deve ter assinatura PNG válida`);
  const ihdrType = buf.subarray(12, 16).toString("ascii");
  assert.equal(ihdrType, "IHDR", `${absPath} deve iniciar com chunk IHDR`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe("PWA Base + Modo TWA Play Store (Fase 1)", () => {
  describe("Web App Manifest e ícones", () => {
    test("manifest.ts exporta MeuPlantão, cores da marca, standalone e start_url /?origem=twa", () => {
      const manifest = manifestModule.default();
      assert.equal(manifest.name, "MeuPlantão");
      assert.equal(manifest.short_name, "MeuPlantão");
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.start_url, "/?origem=twa");
      assert.equal(manifest.background_color, "#F7FAF9");
      assert.equal(manifest.theme_color, "#008A4B");
      assert.equal(manifest.lang, "pt-BR");
      assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
    });

    test("ícones 192, 512 e maskable existem em public/icons com dimensões PNG exatas", () => {
      const manifest = manifestModule.default();
      const icons = manifest.icons ?? [];

      const any192 = icons.find((i) => i.sizes === "192x192" && i.purpose === "any");
      const any512 = icons.find((i) => i.sizes === "512x512" && i.purpose === "any");
      const maskable = icons.filter((i) => i.purpose === "maskable");

      assert.ok(any192, "deve ter ícone 192x192 purpose=any");
      assert.ok(any512, "deve ter ícone 512x512 purpose=any");
      assert.ok(maskable.length >= 1, "deve ter ao menos um ícone purpose=maskable");
      assert.ok(
        maskable.some((i) => i.sizes === "512x512"),
        "deve incluir ícone maskable 512x512",
      );

      for (const icon of icons) {
        const relPath = path.join("public", icon.src.replace(/^\//, ""));
        const absPath = path.join(ROOT, relPath);
        assert.ok(fs.existsSync(absPath), `arquivo de ícone deve existir: ${relPath}`);
        const [expectedW, expectedH] = String(icon.sizes).split("x").map(Number);
        const dims = readPngDimensions(absPath);
        assert.equal(dims.width, expectedW, `${relPath} largura incorreta`);
        assert.equal(dims.height, expectedH, `${relPath} altura incorreta`);
      }
    });
  });

  describe("Página offline e Service Worker seguro", () => {
    test("/offline tem noindex, acessibilidade 44px, reduced-motion e acesso público sem redirect", async () => {
      const offlinePage = read("src/app/offline/page.tsx");
      const offlineActions = read("src/app/offline/offline-actions.tsx");
      const nextConfig = read("next.config.ts");
      const appShell = read("src/components/ui/app-shell.tsx");

      assert.match(offlinePage, /robots:\s*\{[\s\S]*?index:\s*false[\s\S]*?follow:\s*false[\s\S]*?\}/);
      assert.match(offlinePage, /motion-reduce:animate-none/);
      assert.match(offlineActions, /min-h-\[44px\]/);
      assert.ok(nextConfig.includes('"/offline"'), "next.config.ts deve marcar /offline como noindex");
      assert.ok(appShell.includes('"/offline"'), "AppShell deve renderizar /offline sem barra privada");

      globalThis.__twaTestMockUser = null;
      globalThis.__twaTestGetUserCalls = 0;
      const res = await middleware(new NextRequest("http://localhost/offline"));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("location"), null);
      assert.equal(globalThis.__twaTestGetUserCalls, 0);
    });

    test("sw.js faz fallback apenas de navegação para /offline e nunca armazena /api/ ou /auth/", () => {
      const sw = read("public/sw.js");
      const layout = read("src/app/layout.tsx");

      assert.match(sw, /const OFFLINE_URL = "\/offline"/);
      assert.match(sw, /request\.mode !== "navigate"/);
      assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
      assert.match(sw, /url\.pathname\.startsWith\("\/auth\/"\)/);
      assert.doesNotMatch(sw, /cache\.put\(/, "SW não deve gravar páginas autenticadas em cache");
      assert.match(layout, /ServiceWorkerRegister/);
    });
  });

  describe("Detecção da TWA e persistência em cookie", () => {
    test("isTwaContext reconhece ?origem=twa, cookie mp_origem=twa e referrer android-app://", () => {
      assert.equal(ANDROID_PACKAGE_NAME, "pro.meuplantao.app");
      assert.equal(TWA_QUERY_PARAM, "origem");
      assert.equal(TWA_QUERY_VALUE, "twa");

      assert.equal(resolveTwaOriginParam(new URLSearchParams("origem=twa")), "twa");
      assert.equal(resolveTwaOriginParam(new URLSearchParams("origem=TWA")), "twa");
      assert.equal(resolveTwaOriginParam(new URLSearchParams("origem=web")), "web");
      assert.equal(resolveTwaOriginParam(new URLSearchParams("")), null);

      assert.equal(parseCookieValue("foo=1; mp_origem=twa; bar=2"), "twa");
      assert.equal(parseCookieValue("foo=1; bar=2"), null);
      assert.equal(isAndroidTwaReferrer("android-app://pro.meuplantao.app/"), true);
      assert.equal(isAndroidTwaReferrer("https://meuplantao.pro/"), false);

      // 1. Entrada inicial pelo manifest (/?origem=twa)
      assert.equal(isTwaContext({ searchParams: new URLSearchParams("origem=twa") }), true);
      // 2. Navegação subsequente com cookie persistido
      assert.equal(isTwaContext({ cookieHeader: `${TWA_COOKIE_NAME}=twa` }), true);
      // 3. Referrer nativo da TWA
      assert.equal(isTwaContext({ referrer: "android-app://pro.meuplantao.app" }), true);
      // 4. Navegador comum fora da TWA
      assert.equal(
        isTwaContext({
          searchParams: new URLSearchParams(""),
          cookieHeader: "other=1",
          referrer: "https://www.google.com/",
        }),
        false,
      );
      // 5. Override explícito ?origem=web limpa modo TWA
      assert.equal(
        isTwaContext({
          searchParams: new URLSearchParams("origem=web"),
          cookieHeader: `${TWA_COOKIE_NAME}=twa`,
        }),
        false,
      );

      const bootstrap = buildTwaBootstrapScript();
      assert.ok(bootstrap.includes(TWA_COOKIE_NAME));
      assert.ok(bootstrap.includes("dataset.twa"));
    });

    test("middleware transforma ?origem=twa em cookie mp_origem=twa sem alterar requisições web normais", async () => {
      globalThis.__twaTestMockUser = null;

      // Visita pela TWA (/?origem=twa) grava cookie
      const twaRes = await middleware(new NextRequest("http://localhost/?origem=twa"));
      assert.equal(twaRes.status, 200);
      const setCookie = twaRes.headers.get("set-cookie") ?? "";
      assert.match(setCookie, /mp_origem=twa/);
      assert.match(setCookie, /Path=\//i);
      assert.match(setCookie, /Max-Age=31536000/i);

      // Visita normal no navegador NÃO grava cookie mp_origem
      const webRes = await middleware(new NextRequest("http://localhost/"));
      assert.equal(webRes.status, 200);
      assert.ok(!(webRes.headers.get("set-cookie") ?? "").includes("mp_origem="));

      // ?origem=web limpa o cookie
      const clearRes = await middleware(
        new NextRequest("http://localhost/?origem=web", {
          headers: { cookie: "mp_origem=twa" },
        }),
      );
      assert.match(clearRes.headers.get("set-cookie") ?? "", /Max-Age=0/i);

      // Mesmo em redirect (usuário logado em /login?origem=twa -> /dashboard), preserva o cookie
      globalThis.__twaTestMockUser = { id: "user-pro-1" };
      try {
        const redirectRes = await middleware(new NextRequest("http://localhost/login?origem=twa"));
        assert.equal(redirectRes.status, 307);
        assert.match(redirectRes.headers.get("set-cookie") ?? "", /mp_origem=twa/);
      } finally {
        globalThis.__twaTestMockUser = null;
      }
    });
  });

  describe("Ocultação de compra, preço e pagamento externo na TWA", () => {
    test("SubscriptionCard na TWA não exibe preço, checkout, Mercado Pago nem direcionamento externo", () => {
      const src = read("src/components/subscription/subscription-card.tsx");
      assert.match(src, /useIsTwa/);

      const twaStart = src.indexOf("if (isTwa) {");
      const twaEnd = src.indexOf('<Card data-twa-hide="true"');
      assert.ok(twaStart !== -1 && twaEnd > twaStart, "bloco exclusivo da TWA deve existir");

      const twaBlock = src.slice(twaStart, twaEnd);
      for (const forbidden of [
        /R\$/i,
        /12,90/,
        /Assinar/i,
        /Estender/i,
        /Mercado Pago/i,
        /\bPIX\b/i,
        /Cart[ãa]o/i,
        /PlanPeriodSelector/,
        /handleSubscribe/,
        /meuplantao\.pro/i,
        /acesse o site/i,
        /pelo navegador/i,
      ]) {
        assert.doesNotMatch(
          twaBlock,
          forbidden,
          `bloco TWA do SubscriptionCard não pode conter ${forbidden}`,
        );
      }

      // Fora da TWA, o checkout Mercado Pago segue intacto
      const webBlock = src.slice(twaEnd);
      assert.match(webBlock, /Assinar MeuPlantão Pro/);
      assert.match(webBlock, /Mercado Pago/);
      assert.match(webBlock, /handleSubscribe/);
    });

    test("PaywallModal, TrialBadge, Perfil, PendingConfirmation e Landing escondem compra/preço na TWA", () => {
      const paywall = read("src/components/subscription/paywall-modal.tsx");
      assert.match(paywall, /useIsTwa/);
      assert.match(paywall, /!isTwa && \(\s*<Link[\s\S]*?Assinar MeuPlantão Pro/);
      assert.match(paywall, /!isTwa && \(\s*<p[^>]*>[\s\S]*?PIX ou Cartão/);

      const badge = read("src/components/subscription/trial-badge.tsx");
      assert.match(badge, /useIsTwa/);
      assert.match(badge, /Modo leitura/);

      const profile = read("src/app/perfil/page.tsx");
      assert.match(profile, /!isTwa && <Link[^>]*href="\/assinatura"/);

      const pending = read("src/components/dashboard/pending-confirmation.tsx");
      assert.match(pending, /if \(isTwa\) \{\s*setPaywallOpen\(true\);\s*return;\s*\}/);

      const pricing = read("src/components/landing/pricing-section.tsx");
      assert.match(pricing, /if \(isTwa\) return null;/);
      assert.match(pricing, /data-twa-hide="true"/);

      const header = read("src/components/landing/landing-header.tsx");
      const footer = read("src/components/landing/landing-footer.tsx");
      const faq = read("src/components/landing/faq-section.tsx");
      const globalsCss = read("src/app/globals.css");

      assert.match(header, /!isTwa && \(\s*<Link[\s\S]*?href="#preco"/);
      assert.match(footer, /!isTwa && \(\s*<Link href="#preco"/);
      assert.match(faq, /isTwa \? faqs\.filter\(\(item\) => !item\.hideInTwa\) : faqs/);
      assert.match(globalsCss, /html\[data-twa="true"\] \[data-twa-hide="true"\]/);
    });

    test("assinante Pro ativo mantém uso completo normal", () => {
      const now = new Date("2026-11-18T12:00:00.000Z");
      const created = new Date("2026-06-01T12:00:00.000Z").toISOString();
      const periodEnd = new Date("2026-12-18T12:00:00.000Z").toISOString();
      const trial = calculateTrial(created, "active", now, periodEnd);

      assert.equal(trial.isActive, true);
      assert.equal(canCreateShift(trial), true);
    });
  });

  describe("Documentação arquitetural Android", () => {
    test("docs/android/play-store.md documenta TWA, Bubblewrap, pacote e estratégia de pagamento", () => {
      const doc = read("docs/android/play-store.md");
      assert.match(doc, /TWA/);
      assert.match(doc, /Bubblewrap/);
      assert.match(doc, /pro\.meuplantao\.app/);
      assert.match(doc, /Play App Signing/);
      assert.match(doc, /Fase 1/);
      assert.match(doc, /Fase 2/);
      assert.match(doc, /Google Play Billing/);
    });
  });
});
