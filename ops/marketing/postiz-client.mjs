#!/usr/bin/env node
/**
 * Postiz Client CLI & Library — MeuPlantão Marketing Automation
 * 
 * Funcionalidades:
 * 1. Health check da instância do Postiz.
 * 2. Listagem de canais e integrações ativas.
 * 3. Upload e validação de URLs públicas de mídia (prevenção de localhost para Meta).
 * 4. Disparo com verificação assíncrona: só declara sucesso com state === 'EXECUTED' + releaseURL + releaseId.
 * 5. Falha explícita para state === 'ERROR', timeout ou payload inconclusivo.
 * 6. Agendamento com validação de status de fila.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_POSTIZ_URL = 'http://localhost:4007';
export const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'ops/marketing/postiz-config.json');

export function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

export function saveConfig(cfg, configPath = DEFAULT_CONFIG_PATH) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function getMimeType(filePath) {
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

export function isLocalUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.localhost')
    );
  } catch {
    return urlStr.includes('localhost') || urlStr.includes('127.0.0.1');
  }
}

export function validateMediaUrl(mediaUrl, { allowLocal = false } = {}) {
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new Error('URL de mídia vazia ou inválida.');
  }

  if (!allowLocal && isLocalUrl(mediaUrl)) {
    throw new Error(
      `URL de mídia inválida para publicação externa: "${mediaUrl}". ` +
      `A Meta/Instagram Graph API exige URL pública HTTPS persistente. ` +
      `Configure storage R2/S3 no Postiz ou defina storageBaseUrl público.`
    );
  }

  return true;
}

export async function checkHealth({ baseUrl = DEFAULT_POSTIZ_URL, fetchFn = fetch } = {}) {
  console.log(`[Postiz] Verificando conexão com ${baseUrl}...`);
  try {
    const res = await fetchFn(`${baseUrl}/api/health`, { method: 'GET' }).catch(async () => {
      return await fetchFn(`${baseUrl}/`, { method: 'GET' });
    });
    if (res.ok || res.status < 500) {
      console.log(`✅ Postiz está ONLINE e respondendo em ${baseUrl}`);
      return true;
    }
    console.error(`❌ Postiz respondeu com status ${res.status}`);
    return false;
  } catch (err) {
    console.error(`❌ Não foi possível conectar ao Postiz em ${baseUrl}:`, err.message);
    return false;
  }
}

export async function getIntegrations({ baseUrl = DEFAULT_POSTIZ_URL, apiKey, fetchFn = fetch } = {}) {
  if (!apiKey) {
    throw new Error('Chave de API não configurada. Defina POSTIZ_API_KEY ou configure em postiz-config.json');
  }

  const res = await fetchFn(`${baseUrl}/api/public/v1/integrations`, {
    headers: { Authorization: apiKey }
  }).catch(async () => {
    return await fetchFn(`${baseUrl}/public/v1/integrations`, {
      headers: { Authorization: apiKey }
    });
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erro ao buscar integrações (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data;
}

export async function listPosts({ baseUrl = DEFAULT_POSTIZ_URL, apiKey, fetchFn = fetch, startDate, endDate } = {}) {
  if (!apiKey) {
    throw new Error('Chave de API não configurada.');
  }

  const now = new Date();
  const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const endpoint = `${baseUrl}/api/public/v1/posts?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
  const res = await fetchFn(endpoint, {
    headers: { Authorization: apiKey }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erro ao buscar posts (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data;
}

export async function uploadMedia(filePath, { baseUrl = DEFAULT_POSTIZ_URL, apiKey, storageBaseUrl, allowLocal = false, fetchFn = fetch } = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de mídia não encontrado: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const mime = getMimeType(filePath);
  const filename = path.basename(filePath);

  const form = new FormData();
  const blob = new Blob([fileBuffer], { type: mime });
  form.append('file', blob, filename);

  const endpoint = `${baseUrl}/api/public/v1/upload`;
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: { Authorization: apiKey },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha no upload de ${filename} (${res.status}): ${errText}`);
  }

  const uploaded = await res.json();
  let resolvedPath = uploaded.path;

  // Se o storageBaseUrl foi informado e a URL retornada for local, reescreve o prefixo
  if (storageBaseUrl && isLocalUrl(resolvedPath)) {
    const relativePart = resolvedPath.replace(/^https?:\/\/[^/]+/, '');
    resolvedPath = `${storageBaseUrl.replace(/\/$/, '')}${relativePart}`;
  }

  validateMediaUrl(resolvedPath, { allowLocal });
  console.log(`✅ Upload concluído: ${filename} -> id: ${uploaded.id} (${resolvedPath})`);
  return { id: uploaded.id, path: resolvedPath };
}

export async function pollPostStatus(postId, { baseUrl = DEFAULT_POSTIZ_URL, apiKey, timeoutMs = 30000, intervalMs = 2000, fetchFn = fetch } = {}) {
  const startTime = Date.now();
  let lastPost = null;

  while (Date.now() - startTime < timeoutMs) {
    const postsData = await listPosts({ baseUrl, apiKey, fetchFn });
    const postsList = Array.isArray(postsData) ? postsData : (postsData?.posts || []);
    const found = postsList.find(p => p.id === postId);

    if (found) {
      lastPost = found;
      if (found.state === 'EXECUTED') {
        if (found.releaseURL && found.releaseId) {
          return {
            success: true,
            postId: found.id,
            state: 'EXECUTED',
            releaseURL: found.releaseURL,
            releaseId: found.releaseId,
            post: found
          };
        }
        // Se EXECUTED mas ainda sem releaseURL, aguarda próxima iteração
      } else if (found.state === 'ERROR') {
        throw new Error(
          `Falha na publicação do Postiz: o post "${postId}" entrou em estado ERROR. ` +
          `Nenhuma publicação foi concluída no canal.`
        );
      }
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  const stateStr = lastPost?.state || 'NÃO_LOCALIZADO';
  throw new Error(
    `Timeout (${timeoutMs}ms) aguardando processamento final do Postiz. ` +
    `Post "${postId}" permaneceu em estado "${stateStr}". Publicação não pôde ser confirmada.`
  );
}

export async function publishOrSchedule({
  caption,
  mediaFiles = [],
  date,
  integrationId,
  baseUrl = DEFAULT_POSTIZ_URL,
  apiKey,
  storageBaseUrl,
  allowLocal = false,
  timeoutMs = 30000,
  intervalMs = 2000,
  fetchFn = fetch
} = {}) {
  if (!apiKey) {
    throw new Error('POSTIZ_API_KEY não configurada.');
  }

  let chosenIntegration = integrationId;
  if (!chosenIntegration) {
    const integrations = await getIntegrations({ baseUrl, apiKey, fetchFn });
    if (!integrations || integrations.length === 0) {
      throw new Error(`Nenhum canal/integração encontrado no Postiz em ${baseUrl}.`);
    }
    chosenIntegration = integrations[0].id;
  }

  const uploadedImages = [];
  for (const filePath of mediaFiles) {
    console.log(`[Postiz] Processando mídia: ${filePath}`);
    const up = await uploadMedia(filePath, { baseUrl, apiKey, storageBaseUrl, allowLocal, fetchFn });
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

  const endpoint = `${baseUrl}/api/public/v1/posts`;
  console.log(`[Postiz] Enviando payload (${payload.type})...`);
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Erro ao enviar publicação ao Postiz (${res.status}): ${errorText}`);
  }

  const result = await res.json();
  const createdPostId = result.id || (Array.isArray(result) ? result[0]?.id : (result.posts?.[0]?.id));

  if (isSchedule) {
    console.log(`🗓️ Post enfileirado com sucesso para agendamento em ${payload.date} (ID: ${createdPostId || 'N/A'})`);
    return {
      success: true,
      type: 'schedule',
      postId: createdPostId,
      scheduledDate: payload.date,
      response: result
    };
  }

  // Se publicação imediata (type: 'now'), aguarda resolução do Temporal/Postiz
  if (!createdPostId) {
    throw new Error('Falha ao obter o ID do post criado no Postiz para verificação de status.');
  }

  console.log(`[Postiz] Aguardando confirmação assíncrona da publicação (ID: ${createdPostId})...`);
  const execResult = await pollPostStatus(createdPostId, { baseUrl, apiKey, timeoutMs, intervalMs, fetchFn });
  console.log(`🎉 Publicação CONFIRMADA e EXECUTADA com sucesso!`);
  console.log(`   URL no Instagram: ${execResult.releaseURL}`);
  console.log(`   Release ID: ${execResult.releaseId}`);
  return execResult;
}

// CLI Execution Entrypoint
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const config = loadConfig();
  const baseUrl = process.env.POSTIZ_URL || config.postizUrl || DEFAULT_POSTIZ_URL;
  const apiKey = process.env.POSTIZ_API_KEY || config.apiKey || '';
  const storageBaseUrl = process.env.POSTIZ_STORAGE_URL || config.storageBaseUrl || '';

  if (!command || command === 'help') {
    console.log(`
Uso do Postiz Client CLI:
  node ops/marketing/postiz-client.mjs status
  node ops/marketing/postiz-client.mjs set-key <SUA_API_KEY>
  node ops/marketing/postiz-client.mjs channels
  node ops/marketing/postiz-client.mjs list-posts
  node ops/marketing/postiz-client.mjs post --caption "Texto da legenda" --media "path/img.jpg" [--allow-local-media]
  node ops/marketing/postiz-client.mjs schedule --date "2026-09-22T15:30:00" --caption "Texto" --media "path/img.jpg"
`);
    return;
  }

  if (command === 'status') {
    await checkHealth({ baseUrl });
    return;
  }

  if (command === 'set-key') {
    const key = args[1];
    if (!key) {
      console.error('Informe a API Key.');
      process.exit(1);
    }
    config.apiKey = key;
    saveConfig(config);
    console.log(`✅ API Key salva em ${DEFAULT_CONFIG_PATH}`);
    return;
  }

  if (command === 'channels') {
    const integrations = await getIntegrations({ baseUrl, apiKey });
    console.log('[Postiz] Integrações encontradas:', JSON.stringify(integrations, null, 2));
    return;
  }

  if (command === 'list-posts') {
    const posts = await listPosts({ baseUrl, apiKey });
    console.log('[Postiz] Posts encontrados:', JSON.stringify(posts, null, 2));
    return;
  }

  if (command === 'post' || command === 'schedule') {
    let caption = '';
    let media = [];
    let date = null;
    let integrationId = config.defaultIntegrationId || null;
    let allowLocal = false;
    let timeoutMs = 30000;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--caption' && args[i + 1]) caption = args[++i];
      else if (args[i] === '--caption-file' && args[i + 1]) caption = fs.readFileSync(path.resolve(process.cwd(), args[++i]), 'utf-8');
      else if (args[i] === '--media' && args[i + 1]) media = args[++i].split(',').map(s => s.trim());
      else if (args[i] === '--date' && args[i + 1]) date = args[++i];
      else if (args[i] === '--channel' && args[i + 1]) integrationId = args[++i];
      else if (args[i] === '--allow-local-media') allowLocal = true;
      else if (args[i] === '--timeout' && args[i + 1]) timeoutMs = parseInt(args[++i], 10);
    }

    if (!caption && media.length === 0) {
      console.error('Erro: Forneça pelo menos --caption ou --media.');
      process.exit(1);
    }

    if (command === 'schedule' && !date) {
      console.error('Erro: Para agendar, informe --date no formato ISO (ex: "2026-09-22T15:30:00").');
      process.exit(1);
    }

    try {
      await publishOrSchedule({
        caption,
        mediaFiles: media,
        date,
        integrationId,
        baseUrl,
        apiKey,
        storageBaseUrl,
        allowLocal,
        timeoutMs
      });
    } catch (err) {
      console.error(`❌ Falha: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  console.error(`Comando desconhecido: ${command}`);
  process.exit(1);
}

// Executar CLI somente se chamado diretamente
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  main().catch(err => {
    console.error('Erro inesperado:', err.message || err);
    process.exit(1);
  });
}
