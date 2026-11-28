import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SOURCE_SVG_PATH = path.join(ROOT, "public", "brand", "meuplantao-calendar-icon.svg");
const OUTPUT_DIR = path.join(ROOT, "public", "icons");
const BRAND_SURFACE_HEX = "#F7FAF9";

function extractInnerSvg(svgContent) {
  const match = svgContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match) {
    throw new Error("SVG de origem inválido: tag <svg> não encontrada.");
  }
  return match[1].trim();
}

function buildAnyIconSvg(innerElements) {
  // Ícone regular (purpose: "any") com squircle clínico claro para contraste
  // consistente em temas claros e escuros do Android/Chrome.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect x="2" y="2" width="96" height="96" rx="22" fill="${BRAND_SURFACE_HEX}" />
  <g transform="translate(10 10) scale(0.8)">
    ${innerElements}
  </g>
</svg>`;
}

function buildMaskableIconSvg(innerElements) {
  // Ícone maskable (W3C safe zone: círculo central de 80% / raio 40).
  // Escala 0.68 centralizada mantém alças e linha de pulso (x=4..96) dentro do raio seguro.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect width="100" height="100" fill="${BRAND_SURFACE_HEX}" />
  <g transform="translate(16 16) scale(0.68)">
    ${innerElements}
  </g>
</svg>`;
}

async function renderPng(svgMarkup, size, outputPath) {
  await sharp(Buffer.from(svgMarkup), { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function main() {
  const rawSvg = fs.readFileSync(SOURCE_SVG_PATH, "utf8");
  const innerElements = extractInnerSvg(rawSvg);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const anySvg = buildAnyIconSvg(innerElements);
  const maskableSvg = buildMaskableIconSvg(innerElements);

  const targets = [
    { file: "icon-192.png", size: 192, svg: anySvg },
    { file: "icon-512.png", size: 512, svg: anySvg },
    { file: "icon-maskable-192.png", size: 192, svg: maskableSvg },
    { file: "icon-maskable-512.png", size: 512, svg: maskableSvg },
  ];

  for (const target of targets) {
    const outPath = path.join(OUTPUT_DIR, target.file);
    await renderPng(target.svg, target.size, outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`Generated ${target.file}: ${meta.width}x${meta.height} (${meta.format})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
