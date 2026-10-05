import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { historyLogOptions } from '../scripts/secret-scan-range.mjs';

test('secret scan chooses complete reachable history for rewritten pushes, never skips', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'secret-range-regression-'));
  function git(...args) {
    const r = spawnSync('git', ['-c', 'user.name=Offline regression',
      '-c', 'user.email=offline@example.test', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, 'temporary Git operation must succeed');
    return r.stdout.trim();
  }
  try {
    git('init');
    git('commit', '--allow-empty', '-m', 'baseline');
    const base = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'normal update');
    const head = git('rev-parse', 'HEAD');
    const range = base + '..' + head;
    assert.equal(historyLogOptions(repo, range), range);
    assert.equal(historyLogOptions(repo, range, true), range);
    const missing = '1'.repeat(40);
    assert.equal(historyLogOptions(repo, missing + '..' + head, true), '--all');
    assert.equal(historyLogOptions(repo, '0'.repeat(40) + '..' + head, true), '--all');
    assert.throws(() => historyLogOptions(repo, missing + '..' + head), /base unavailable/);
    assert.throws(() => historyLogOptions(repo, base + '..' + missing, true), /head unavailable/);
    git('checkout', '--orphan', 'rewritten-main');
    git('commit', '--allow-empty', '-m', 'rewritten root');
    const rewritten = git('rev-parse', 'HEAD');
    assert.equal(historyLogOptions(repo, head + '..' + rewritten, true), '--all');
    // A PR with a divergent (but present) base still uses a verifiable range.
    assert.equal(historyLogOptions(repo, head + '..' + rewritten), head + '..' + rewritten);
    assert.throws(() => historyLogOptions(repo, '--all'), /Invalid scan range/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
