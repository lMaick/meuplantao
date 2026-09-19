#!/usr/bin/env node
/**
 * MeuPlantão — Gerador Automatizado de Imagens para Redes Sociais
 * 
 * Gera posts e carrosséis com fidelidade 100% à identidade visual do MeuPlantão:
 * - Logotipo vetorial oficial embutido (Calendário com pulso verde)
 * - Tipografia Plus Jakarta Sans
 * - Paleta oficial do produto
 * - Exportação de PNGs em 1080x1350 (4:5 Feed Instagram) ou 1080x1080 (1:1)
 * 
 * Uso:
 *   node ops/marketing/generate-post-images.mjs --post ops/marketing/posts/post-2.json
 *   node ops/marketing/generate-post-images.mjs --type quote --quote "Aquele plantão de 3 meses atrás..." --out ops/marketing/assets/post-1.png
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  renderCoverTemplate,
  renderStepTemplate,
  renderClosingTemplate,
  renderStaticQuoteTemplate
} from './templates/social-templates.mjs';

const execFileAsync = promisify(execFile);

// Encontrar executável do navegador (Edge ou Chrome nativo)
function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback para comando no PATH
  return process.platform === 'win32' ? 'msedge.exe' : 'google-chrome';
}

/**
 * Renderiza uma string HTML em arquivo de imagem PNG usando o headless browser
 */
async function renderHtmlToImage(htmlContent, outputPath, options = {}) {
  const width = options.width || 1080;
  const height = options.height || 1350;

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Arquivo HTML temporário
  const tempHtmlPath = path.resolve(outDir, `_temp_${Date.now()}_${Math.random().toString(36).substring(7)}.html`);
  fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');

  const browserPath = findBrowserExecutable();
  const fileUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');

  const browserArgs = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=1500', // Dá tempo para fontes externas carregarem
    `--screenshot=${outputPath}`,
    fileUrl
  ];

  try {
    await execFileAsync(browserPath, browserArgs, { timeout: 30000 });
    if (!fs.existsSync(outputPath)) {
      // Tentar com modo headless legado se --headless=new falhar
      const fallbackArgs = [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${width},${height}`,
        `--screenshot=${outputPath}`,
        fileUrl
      ];
      await execFileAsync(browserPath, fallbackArgs, { timeout: 30000 });
    }
  } finally {
    // Limpar arquivo temporário
    if (fs.existsSync(tempHtmlPath)) {
      try { fs.unlinkSync(tempHtmlPath); } catch {}
    }
  }

  return outputPath;
}

/**
 * Gera um conjunto completo de imagens a partir de um arquivo de definição de post (JSON)
 */
async function generatePostFromJson(jsonPath) {
  const fullPath = path.resolve(process.cwd(), jsonPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Arquivo de post não encontrado: ${jsonPath}`);
  }

  const postDef = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  const postId = postDef.id || path.basename(jsonPath, path.extname(jsonPath));
  const outputFolder = path.resolve(process.cwd(), postDef.outputDir || `ops/marketing/assets/${postId}`);

  if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
  }

  console.log(`\n🎨 [MeuPlantão] Gerando imagens para o post: "${postDef.title || postId}"`);
  console.log(`📁 Pasta de saída: ${outputFolder}\n`);

  const generatedFiles = [];

  // Se for carrossel
  if (postDef.type === 'carousel' && Array.isArray(postDef.slides)) {
    const totalSlides = postDef.slides.length;

    for (let i = 0; i < totalSlides; i++) {
      const slide = postDef.slides[i];
      const slideNumber = i + 1;
      const fileName = `slide-${slideNumber}.png`;
      const outFile = path.resolve(outputFolder, fileName);

      let html = '';
      if (slide.template === 'cover' || i === 0) {
        html = renderCoverTemplate({
          badge: slide.badge || postDef.badge,
          title: slide.title,
          subtitle: slide.subtitle,
          totalSlides,
          highlightWords: slide.highlightWords || []
        });
      } else if (slide.template === 'closing' || i === totalSlides - 1) {
        html = renderClosingTemplate({
          currentSlide: slideNumber,
          totalSlides,
          headline: slide.headline,
          ctaTitle: slide.ctaTitle,
          ctaUrl: slide.ctaUrl,
          bulletPoints: slide.bulletPoints,
          badge: slide.badge || 'Resultado'
        });
      } else {
        html = renderStepTemplate({
          stepNumber: slide.stepNumber || slideNumber - 1,
          totalSteps: postDef.totalSteps || totalSlides - 2,
          currentSlide: slideNumber,
          totalSlides,
          stepTag: slide.stepTag,
          title: slide.title,
          description: slide.description,
          highlightBox: slide.highlightBox,
          badge: slide.badge || postDef.badge
        });
      }

      console.log(`  ⏳ Renderizando Slide ${slideNumber}/${totalSlides} (${slide.title || 'Slide'})...`);
      await renderHtmlToImage(html, outFile, { width: 1080, height: 1350 });
      console.log(`  ✅ Salvo: ${fileName}`);
      generatedFiles.push(outFile);
    }
  } 
  // Se for post estático (quote/dor)
  else if (postDef.type === 'quote' || postDef.type === 'static') {
    const outFile = path.resolve(outputFolder, `${postId}.png`);
    const html = renderStaticQuoteTemplate({
      badge: postDef.badge || 'Conscientização',
      quote: postDef.quote || postDef.title,
      subtext: postDef.subtext || postDef.subtitle,
      cta: postDef.cta || 'Teste grátis: www.meuplantao.pro'
    });

    console.log(`  ⏳ Renderizando Post Estático...`);
    await renderHtmlToImage(html, outFile, { width: 1080, height: 1350 });
    console.log(`  ✅ Salvo: ${path.basename(outFile)}`);
    generatedFiles.push(outFile);
  }

  console.log(`\n🎉 Concluído com sucesso! ${generatedFiles.length} imagem(ns) gerada(s).`);
  return generatedFiles;
}

// CLI Argument Parsing
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Uso do Gerador de Imagens MeuPlantão:
  node ops/marketing/generate-post-images.mjs --post <caminho-para-json>
  node ops/marketing/generate-post-images.mjs --quote "Texto da frase" --subtext "Subtexto" --out "caminho.png"

Exemplos:
  node ops/marketing/generate-post-images.mjs --post ops/marketing/posts/post-2.json
  node ops/marketing/generate-post-images.mjs --post ops/marketing/posts/post-1.json
`);
    return;
  }

  let jsonPath = null;
  let quote = null;
  let subtext = null;
  let outFile = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--post' && args[i + 1]) jsonPath = args[++i];
    else if (args[i] === '--quote' && args[i + 1]) quote = args[++i];
    else if (args[i] === '--subtext' && args[i + 1]) subtext = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outFile = args[++i];
  }

  if (jsonPath) {
    await generatePostFromJson(jsonPath);
    return;
  }

  if (quote) {
    const targetOut = path.resolve(process.cwd(), outFile || 'ops/marketing/assets/quick-quote.png');
    const html = renderStaticQuoteTemplate({
      quote,
      subtext: subtext || 'Se você precisou pensar para responder, esse post é pra você.'
    });
    console.log(`⏳ Gerando post estático com a identidade oficial...`);
    await renderHtmlToImage(html, targetOut, { width: 1080, height: 1350 });
    console.log(`✅ Imagem gerada com sucesso em: ${targetOut}`);
    return;
  }

  console.error('Parâmetros inválidos. Use --help para instruções.');
}

main().catch(err => {
  console.error('❌ Erro durante a geração:', err);
  process.exit(1);
});
