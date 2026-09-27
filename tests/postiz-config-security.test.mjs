import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { isPlaceholder, resolveApiKey } from '../ops/marketing/postiz-client.mjs';

test('Segurança Postiz: ops/marketing/postiz-config.json deve estar no .gitignore', () => {
  const gitignoreContent = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf-8');
  assert.match(
    gitignoreContent,
    /ops\/marketing\/postiz-config\.json/,
    '.gitignore deve conter ops/marketing/postiz-config.json'
  );

  const checkIgnoreOutput = execSync('git check-ignore ops/marketing/postiz-config.json', {
    encoding: 'utf-8',
  }).trim();
  assert.equal(checkIgnoreOutput, 'ops/marketing/postiz-config.json');
});

test('Segurança Postiz: ops/marketing/postiz-config.json NÃO deve estar rastreado no index do Git', () => {
  const trackedFiles = execSync('git ls-files ops/marketing/postiz-config.json', {
    encoding: 'utf-8',
  }).trim();
  assert.equal(trackedFiles, '', 'postiz-config.json não pode estar presente no git ls-files');
});

test('Segurança Postiz: ops/marketing/postiz-config.example.json deve existir com schema e placeholders corretos', () => {
  const examplePath = path.resolve(process.cwd(), 'ops/marketing/postiz-config.example.json');
  assert.ok(fs.existsSync(examplePath), 'postiz-config.example.json deve existir');

  const content = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
  assert.equal(content.apiKey, '${POSTIZ_API_KEY}');
  assert.equal(typeof content.defaultIntegrationId, 'string');
  assert.equal(typeof content.defaultChannelName, 'string');
});

test('Segurança Postiz: isPlaceholder deve identificar placeholders e ignorar chaves reais', () => {
  assert.equal(isPlaceholder('${POSTIZ_API_KEY}'), true);
  assert.equal(isPlaceholder('${SECRET_KEY}'), true);
  assert.equal(isPlaceholder('SUA_API_KEY'), true);
  assert.equal(isPlaceholder('<SUA_API_KEY>'), true);
  assert.equal(isPlaceholder(''), true);
  assert.equal(isPlaceholder('   '), true);

  assert.equal(isPlaceholder('postiz_secret_token_12345'), false);
  assert.equal(isPlaceholder('cmk1234abc5678'), false);
});

test('Segurança Postiz: resolveApiKey deve priorizar env e ignorar placeholders', () => {
  // Caso 1: config tem placeholder, env vazio -> deve retornar string vazia
  const emptyFromPlaceholder = resolveApiKey(
    { apiKey: '${POSTIZ_API_KEY}' },
    { POSTIZ_API_KEY: '' }
  );
  assert.equal(emptyFromPlaceholder, '');

  // Caso 2: env tem chave real -> prioridade absoluta sobre config
  const fromEnv = resolveApiKey(
    { apiKey: 'config_key' },
    { POSTIZ_API_KEY: 'env_real_key' }
  );
  assert.equal(fromEnv, 'env_real_key');

  // Caso 3: env tem placeholder -> fallback para config real
  const fromConfigFallback = resolveApiKey(
    { apiKey: 'config_real_key' },
    { POSTIZ_API_KEY: '${POSTIZ_API_KEY}' }
  );
  assert.equal(fromConfigFallback, 'config_real_key');

  // Caso 4: ambos com placeholder -> string vazia
  const bothPlaceholders = resolveApiKey(
    { apiKey: '${POSTIZ_API_KEY}' },
    { POSTIZ_API_KEY: '${POSTIZ_API_KEY}' }
  );
  assert.equal(bothPlaceholders, '');
});
