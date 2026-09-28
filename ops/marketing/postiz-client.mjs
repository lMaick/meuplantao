#!/usr/bin/env node
/**
 * Postiz Client CLI - MeuPlantão Marketing Automation
 * 
 * Permite ao agente ou usuário:
 * 1. Verificar saúde da instância local do Postiz (http://localhost:4007)
 * 2. Listar integrações conectadas (Instagram / Facebook)
 * 3. Fazer upload de mídias (imagens / carrossel / vídeos)
 * 4. Postar imediatamente ou agendar publicação no Instagram/Facebook
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POSTIZ_URL = process.env.POSTIZ_URL || 'http://localhost:4007';
const CONFIG_PATH = path.resolve(process.cwd(), 'ops/marketing/postiz-config.json');

export function isPlaceholder(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return (
    trimmed === '' ||
    /^\$\{[A-Za-z0-9_]+\}$/.test(trimmed) ||
    trimmed === 'SUA_API_KEY' ||
    trimmed.startsWith('<SUA_')
  );
}

export function tryLoadEnv() {
  for (const envFile of ['.env.local', '.env']) {
    const fullPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(fullPath) && typeof process.loadEnvFile === 'function') {
      try {
        process.loadEnvFile(fullPath);
      } catch {
        // Silently skip if env file cannot be parsed
      }
    }
  }
}

export function loadConfig(configPath = CONFIG_PATH) {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

export function saveConfig(cfg, configPath = CONFIG_PATH) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function resolveApiKey(cfg = {}, env = process.env) {
  const envKey = (env.POSTIZ_API_KEY || '').trim();
  if (envKey && !isPlaceholder(envKey)) {
    return envKey;
  }
  const configKey = (cfg.apiKey || '').trim();
  if (configKey && !isPlaceholder(configKey)) {
    return configKey;
  }
  return '';
}

tryLoadEnv();
const config = loadConfig();
const API_KEY = resolveApiKey(config);


function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

async function checkHealth() {
  console.log(`[Postiz] Verificando conexão com ${POSTIZ_URL}...`);
  try {
    const res = await fetch(`${POSTIZ_URL}/api/health`, { method: 'GET' }).catch(async () => {
      // Tentar endpoint raiz se /api/health não responder
      return await fetch(`${POSTIZ_URL}/`, { method: 'GET' });
    });
    if (res.ok || res.status < 500) {
      console.log(`✅ Postiz está ONLINE e respondendo em ${POSTIZ_URL}`);
      return true;
    }
    console.error(`❌ Postiz respondeu com status ${res.status}`);
    return false;
  } catch (err) {
    console.error(`❌ Não foi possível conectar ao Postiz em ${POSTIZ_URL}:`, err.message);
    console.log(`\n💡 Dica: Inicie o container Docker do Postiz com:`);
    console.log(`   cd "C:\\Users\\Maick\\Documents\\postiz-docker-compose"`);
    console.log(`   docker compose up -d\n`);
    return false;
  }
}

async function getIntegrations() {
  if (!API_KEY) {
    console.error(`❌ Chave de API não configurada. Defina POSTIZ_API_KEY ou configure em ${CONFIG_PATH}`);
    return [];
  }

  const res = await fetch(`${POSTIZ_URL}/api/public/v1/integrations`, {
    headers: { Authorization: API_KEY }
  }).catch(async () => {
    // Tentar fallback se /api/ não for o prefixo
    return await fetch(`${POSTIZ_URL}/public/v1/integrations`, {
      headers: { Authorization: API_KEY }
    });
  });

  if (!res.ok) {
    console.error(`❌ Erro ao buscar integrações (${res.status}): ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  console.log(`[Postiz] Integrações encontradas:`, data);
  return data;
}

async function listPosts() {
  if (!API_KEY) {
    console.error(`❌ Chave de API não configurada.`);
    return [];
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const endpoint = `${POSTIZ_URL}/api/public/v1/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const res = await fetch(endpoint, {
    headers: { Authorization: API_KEY }
  });

  if (!res.ok) {
    console.error(`❌ Erro ao buscar posts (${res.status}): ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  console.log(`[Postiz] Posts encontrados:`, JSON.stringify(data, null, 2));
  return data;
}

async function uploadMedia(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const mime = getMimeType(filePath);
  const filename = path.basename(filePath);

  const form = new FormData();
  const blob = new Blob([fileBuffer], { type: mime });
  form.append('file', blob, filename);

  const endpoint = `${POSTIZ_URL}/api/public/v1/upload`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: API_KEY },
    body: form
  });

  if (!res.ok) {
    throw new Error(`Falha no upload de ${filename} (${res.status}): ${await res.text()}`);
  }

  const uploaded = await res.json();
  console.log(`✅ Upload concluído: ${filename} -> id: ${uploaded.id}`);
  return uploaded;
}

async function publishOrSchedule({ caption, mediaFiles = [], date, integrationId }) {
  if (!API_KEY) {
    throw new Error(`POSTIZ_API_KEY não configurada.`);
  }

  let chosenIntegration = integrationId || config.defaultIntegrationId;
  if (!chosenIntegration) {
    console.log(`Buscando canal padrão de postagem...`);
    const integrations = await getIntegrations();
    if (!integrations || integrations.length === 0) {
      throw new Error(`Nenhum canal/integração encontrado no Postiz. Conecte sua conta do Instagram/Facebook em ${POSTIZ_URL}`);
    }
    chosenIntegration = integrations[0].id;
    console.log(`Canal selecionado automaticamente: ${integrations[0].name || integrations[0].id}`);
  }

  const uploadedImages = [];
  for (const filePath of mediaFiles) {
    console.log(`Enviando mídia: ${filePath}`);
    const up = await uploadMedia(filePath);

    // Validação estrita de URL pública
    if (!up.path || !up.path.startsWith('https://') || up.path.includes('localhost') || up.path.includes('127.0.0.1')) {
      throw new Error(`❌ URL inválida retornada pelo storage: ${up.path}. A Meta exige URL pública HTTPS.`);
    }

    uploadedImages.push({ id: up.id, path: up.path });
  }

  const isSchedule = !!date;
  const payload = {
    type: isSchedule ? 'schedule' : 'now',
    date: isSchedule ? new Date(date).toISOString() : new Date().toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: chosenIntegration },
        settings: {
          post_type: 'post'
        },
        value: [
          {
            content: caption,
            image: uploadedImages
          }
        ]
      }
    ]
  };

  console.log(`\n🔍 [Payload de Publicação Inspecionado]:`);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n✅ Todas as ${uploadedImages.length} imagens estão com URLs públicas HTTPS validadas no Cloudflare R2.\n`);

  const endpoint = `${POSTIZ_URL}/api/public/v1/posts`;
  console.log(`[Postiz] Enviando publicação para a fila (${payload.type})...`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Erro ao publicar no Postiz (${res.status}): ${errorText}`);
  }

  const result = await res.json();
  if (isSchedule) {
    console.log(`🎉 Post agendado com sucesso para ${payload.date}!`);
  } else {
    console.log(`🎉 Post enviado para publicação imediata no canal!`);
  }
  return result;
}

// CLI Argument Parsing
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help') {
    console.log(`
Uso do Postiz Client CLI:
  node ops/marketing/postiz-client.mjs status
  node ops/marketing/postiz-client.mjs set-key <SUA_API_KEY>
  node ops/marketing/postiz-client.mjs channels
  node ops/marketing/postiz-client.mjs post --caption "Texto da legenda" --media "caminho/img1.jpg,caminho/img2.jpg"
  node ops/marketing/postiz-client.mjs schedule --date "2026-09-18T19:30:00" --caption "Texto" --media "caminho/img.jpg"
`);
    return;
  }

  if (command === 'status') {
    await checkHealth();
    return;
  }

  if (command === 'set-key') {
    const key = args[1];
    if (!key || isPlaceholder(key)) {
      console.error(`❌ Informe uma API Key válida (não placeholder).`);
      process.exit(1);
    }
    config.apiKey = key;
    saveConfig(config);
    console.log(`✅ API Key salva em ${CONFIG_PATH}`);
    console.log(`ℹ️ O arquivo ${CONFIG_PATH} é ignorado pelo Git para proteger credenciais.`);
    return;
  }

  if (command === 'channels') {
    await getIntegrations();
    return;
  }

  if (command === 'list-posts') {
    await listPosts();
    return;
  }

  if (command === 'post' || command === 'schedule') {
    let caption = '';
    let media = [];
    let date = null;
    let integrationId = null;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--caption' && args[i + 1]) caption = args[++i];
      else if (args[i] === '--caption-file' && args[i + 1]) caption = fs.readFileSync(path.resolve(process.cwd(), args[++i]), 'utf-8');
      else if (args[i] === '--media' && args[i + 1]) media = args[++i].split(',').map(s => s.trim());
      else if (args[i] === '--date' && args[i + 1]) date = args[++i];
      else if (args[i] === '--channel' && args[i + 1]) integrationId = args[++i];
    }

    if (!caption && media.length === 0) {
      console.error(`Erro: Forneça pelo menos --caption ou --media.`);
      process.exit(1);
    }

    if (command === 'schedule' && !date) {
      console.error(`Erro: Para agendar, informe --date no formato ISO (ex: "2026-09-18T19:30:00").`);
      process.exit(1);
    }

    try {
      await publishOrSchedule({ caption, mediaFiles: media, date, integrationId });
    } catch (err) {
      console.error(`❌ Falha:`, err.message);
      process.exit(1);
    }
    return;
  }

  if (command === 'schedule-json' || command === 'post-json') {
    let postJsonPath = null;
    let date = null;
    let integrationId = null;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--post' && args[i + 1]) postJsonPath = args[++i];
      else if (args[i] === '--date' && args[i + 1]) date = args[++i];
      else if (args[i] === '--channel' && args[i + 1]) integrationId = args[++i];
    }

    if (!postJsonPath) {
      console.error(`Erro: Informe o arquivo do post com --post ops/marketing/posts/<arquivo.json>`);
      process.exit(1);
    }

    const fullJsonPath = path.resolve(process.cwd(), postJsonPath);
    if (!fs.existsSync(fullJsonPath)) {
      console.error(`Arquivo não encontrado: ${fullJsonPath}`);
      process.exit(1);
    }

    const postData = JSON.parse(fs.readFileSync(fullJsonPath, 'utf-8'));
    const scheduledDate = date || postData.scheduledDate || (command === 'schedule-json' ? new Date(Date.now() + 3600000).toISOString() : null);
    const assetFolder = path.resolve(process.cwd(), postData.outputDir || `ops/marketing/assets/${postData.id || path.basename(postJsonPath, '.json')}`);

    let mediaFiles = [];
    if (fs.existsSync(assetFolder)) {
      const files = fs.readdirSync(assetFolder)
        .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'))
        .sort((a, b) => {
          // Ordenar slide-1, slide-2...
          const numA = parseInt(a.replace(/\D/g, '')) || 0;
          const numB = parseInt(b.replace(/\D/g, '')) || 0;
          return numA - numB;
        });
      mediaFiles = files.map(f => path.join(assetFolder, f));
    }

    if (mediaFiles.length === 0) {
      console.error(`❌ Nenhuma imagem encontrada em ${assetFolder}. Execute antes:`);
      console.log(`   node ops/marketing/generate-post-images.mjs --post ${postJsonPath}`);
      process.exit(1);
    }

    console.log(`\n🚀 [MeuPlantão Postiz] Enviando ${mediaFiles.length} mídia(s) do post: ${postData.title || postData.id}`);
    try {
      await publishOrSchedule({
        caption: postData.caption,
        mediaFiles,
        date: scheduledDate,
        integrationId
      });
    } catch (err) {
      console.error(`❌ Falha:`, err.message);
      process.exit(1);
    }
    return;
  }

  console.error(`Comando desconhecido: ${command}`);
}

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    const executedFile = path.resolve(process.argv[1]);
    const currentFile = fileURLToPath(import.meta.url);
    return executedFile === currentFile;
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  main().catch(err => {
    console.error('Erro inesperado:', err);
    process.exit(1);
  });
}

