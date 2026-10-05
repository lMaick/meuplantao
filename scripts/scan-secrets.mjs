import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { historyLogOptions } from './secret-scan-range.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(root, '.github/security/gitleaks.toml');
const binary = process.env.GITLEAKS_BIN || 'gitleaks';
const version = spawnSync(binary, ['version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== '8.30.1') {
  console.error('Secret scan requires Gitleaks 8.30.1 (set GITLEAKS_BIN).');
  process.exit(2);
}

// Never relay stderr from Git: a malformed path/ref could contain a credential.
function git(args) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Git input unavailable; secret scan failed closed.');
  return result.stdout;
}
function scan(args) {
  const reportDir = mkdtempSync(path.join(tmpdir(), 'meuplantao-scan-report-'));
  try {
    const report = path.join(reportDir, 'redacted.json');
    const result = spawnSync(binary, [...args, '--config', config, '--redact=100',
      '--no-banner', '--ignore-gitleaks-allow', '--exit-code', '1',
      '--report-format', 'json', '--report-path', report], { encoding: 'utf8' });
    if (result.status === 0 || result.status === 1) {
      // Print only location and rule. Never relay Match, Secret, author/message,
      // the provider response, or the scanner's stdout/stderr.
      const findings = JSON.parse(readFileSync(report, 'utf8')) || [];
      console.log(JSON.stringify({ findings: findings.map(f => ({ rule: f.RuleID,
        file: f.File.replaceAll('\\', '/').replace(args[1].replaceAll('\\', '/') + '/', ''), line: f.StartLine })) }));
    } else console.error('Gitleaks failed; raw diagnostic output withheld.');
    return result.status === 0 ? 0 : result.status === 1 ? 1 : 2;
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
let temporary;
try {
  if (args.length === 1 && args[0] === '--self-test') {
    temporary = mkdtempSync(path.join(tmpdir(), 'meuplantao-secret-regression-'));
    // Synthetic values generated in memory: never a real provider credential.
    const fake = 'ghp_' + 'A1b2C3d4'.repeat(5);
    writeFileSync(path.join(temporary, 'seed.txt'), fake + '\n');
    if (scan(['dir', temporary]) !== 1) throw new Error('Provider seed detection failed.');
    writeFileSync(path.join(temporary, 'seed.txt'), 'apiKey: "' + 'deadbeef'.repeat(8) + '"\n');
    if (scan(['dir', temporary]) !== 1) throw new Error('Opaque API seed detection failed.');
    writeFileSync(path.join(temporary, 'seed.txt'), 'apiKey: "${POSTIZ_API_KEY}"\n');
    if (scan(['dir', temporary]) !== 0) throw new Error('Placeholder regression failed.');
    mkdirSync(path.join(temporary, 'tests'));
    const fixture = path.join(temporary, 'tests/observability.test.mjs');
    const offlineToken = 'sbp_' + 'abcdef1234567890';
    writeFileSync(fixture, 'access_token: "' + offlineToken + '"\n');
    if (scan(['dir', temporary]) !== 0) throw new Error('Reviewed fixture regression failed.');
    writeFileSync(fixture, fake + '\n');
    if (scan(['dir', temporary]) !== 1) throw new Error('Test file secret bypass detected.');
    writeFileSync(fixture, '');
    writeFileSync(path.join(temporary, 'seed.txt'), 'access_token: "' + offlineToken + '"\n');
    if (scan(['dir', temporary]) !== 1) throw new Error('Fixture path binding bypass detected.');
    writeFileSync(path.join(temporary, 'seed.txt'), '');
    const fixtureDirectory = path.join(temporary, 'ops/meuplantao-dispatcher');
    mkdirSync(fixtureDirectory, { recursive: true });
    const pemFixture = path.join(fixtureDirectory, 'test_dispatcher_linear_bus.py');
    const begin = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
    const end = '-----END ' + 'RSA PRIVATE KEY-----';
    const invalidPem = begin + '\\nMERR\\n' + end;
    writeFileSync(pemFixture, invalidPem);
    if (scan(['dir', temporary]) !== 0) throw new Error('Invalid PEM fixture regression failed.');
    const { privateKey: offlinePem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    writeFileSync(pemFixture, invalidPem + '\n' + offlinePem);
    if (scan(['dir', temporary]) !== 1) throw new Error('Adjacent PEM fixture bypass detected.');
    writeFileSync(pemFixture, offlinePem);
    if (scan(['dir', temporary]) !== 1) throw new Error('Valid offline PEM detection failed.');
    const parsedOfflineKey = createPrivateKey(offlinePem);
    const formats = [
      parsedOfflineKey.export({ type: 'pkcs8', format: 'pem' }),
      parsedOfflineKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'offline-regression' }),
      generateKeyPairSync('ec', { namedCurve: 'prime256v1',
        privateKeyEncoding: { type: 'sec1', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey,
    ];
    for (const pem of formats) {
      writeFileSync(pemFixture, invalidPem + '\n' + pem);
      if (scan(['dir', temporary]) !== 1) throw new Error('Generated PEM format detection failed.');
    }
    // Marker compatibility for other upstream formats. These wrapped bodies
    // are synthetic detector inputs, not claimed to be valid DSA/OpenSSH/PGP keys.
    for (const label of ['DSA', 'OPENSSH', 'PGP']) {
      const suffix = label === 'PGP' ? ' BLOCK' : '';
      const markerPem = '-----BEGIN ' + label + ' PRIVATE KEY' + suffix + '-----\n'
        + 'QUJD'.repeat(32) + '\n-----END ' + label + ' PRIVATE KEY' + suffix + '-----';
      writeFileSync(pemFixture, invalidPem + '\n' + markerPem);
      if (scan(['dir', temporary]) !== 1) throw new Error('PEM marker compatibility failed.');
    }
    writeFileSync(pemFixture, '');
    writeFileSync(path.join(temporary, 'seed.txt'), invalidPem);
    if (scan(['dir', temporary]) !== 1) throw new Error('Invalid PEM fixture path bypass detected.');
    writeFileSync(path.join(temporary, 'seed.txt'), offlinePem);
    if (scan(['dir', temporary]) !== 1) throw new Error('Valid PEM outside fixture detection failed.');
    writeFileSync(path.join(temporary, 'seed.txt'), '');
    mkdirSync(path.join(temporary, 'ops/marketing'));
    const example = path.join(temporary, 'ops/marketing/postiz-config.example.json');
    const historicalPlaceholder = 'YOUR_' + 'POSTIZ_API_KEY_HERE';
    const placeholderText = JSON.stringify({ apiKey: historicalPlaceholder });
    writeFileSync(example, placeholderText);
    if (scan(['dir', temporary]) !== 0) throw new Error('Historical placeholder regression failed.');
    writeFileSync(example, '');
    writeFileSync(path.join(temporary, 'seed.txt'), placeholderText);
    if (scan(['dir', temporary]) !== 1) throw new Error('Historical placeholder path bypass detected.');
    const seedRepo = path.join(temporary, 'history');
    mkdirSync(seedRepo);
    function seedGit(...gitArgs) {
      const r = spawnSync('git', ['-c', 'user.name=Offline scanner regression',
        '-c', 'user.email=scanner@example.test', ...gitArgs], { cwd: seedRepo, encoding: 'utf8' });
      if (r.status !== 0) throw new Error('History regression setup failed.');
      return r.stdout.trim();
    }
    seedGit('init');
    seedGit('commit', '--allow-empty', '-m', 'safe baseline');
    const base = seedGit('rev-parse', 'HEAD');
    writeFileSync(path.join(seedRepo, 'transient.txt'), fake + '\n');
    seedGit('add', 'transient.txt');
    seedGit('commit', '-m', 'synthetic seed');
    seedGit('rm', 'transient.txt');
    seedGit('commit', '-m', 'remove synthetic seed');
    const head = seedGit('rev-parse', 'HEAD');
    if (scan(['git', seedRepo, '--log-opts=' + base + '..' + head]) !== 1) {
      throw new Error('Add-then-remove history bypass detected.');
    }
    console.log('Secret scanner regression passed (synthetic seed rejected, placeholder accepted).');
  } else if (args.length === 1 && args[0] === '--all-history') {
    process.exitCode = scan(['git', root, '--log-opts=--all']);
  } else if (args.length === 2 && ['--range', '--push-range'].includes(args[0])) {
    // Scan every new commit, including secrets added and removed within a PR.
    process.exitCode = scan(['git', root, '--log-opts=' + historyLogOptions(root, args[1], args[0] === '--push-range')]);
  } else if (args.length === 0) {
    // Export only stage-0 tracked blobs. Untracked .env.local, private configs,
    // worktree administration and submodule contents never enter the scanner.
    temporary = mkdtempSync(path.join(tmpdir(), 'meuplantao-secret-index-'));
    const entries = git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
    for (const entry of entries) {
      const match = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(entry);
      if (!match || match[3] !== '0') throw new Error('Unmerged index; scan failed closed.');
      const [, mode, oid, , name] = match;
      if (mode === '160000') continue;
      if (/(^|\/)\.env(?:\..+)?$/.test(name) && !/\.example$/.test(name)
        || /(^|\/)postiz-config(?:\.[^.]+)?\.json$/.test(name) && !/\.example\.json$/.test(name)
        || /\.(?:pem|p12|pfx|key)$/.test(name)) {
        throw new Error('Tracked local credential file prohibited; remove it from the index.');
      }
      const destination = path.resolve(temporary, name);
      if (!destination.startsWith(temporary + path.sep)) throw new Error('Unsafe index path.');
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, git(['cat-file', 'blob', oid]));
    }
    process.exitCode = scan(['dir', temporary]);
  } else {
    throw new Error('Usage: node scripts/scan-secrets.mjs [--self-test|--all-history|--range BASE_SHA..HEAD_SHA|--push-range BASE_SHA..HEAD_SHA]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
