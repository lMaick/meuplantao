import { spawnSync } from 'node:child_process';

// A rewrite push can reference an old SHA unavailable to a fresh clone. Scan
// the entire new reachable history in that case; never turn an error into skip.
export function historyLogOptions(repo, range, isPush = false) {
  if (!/^[0-9a-f]{40}\.\.[0-9a-f]{40}$/.test(range)) throw new Error('Invalid scan range.');
  const [base, head] = range.split('..');
  const run = (...args) => spawnSync('git', args, { cwd: repo, stdio: 'ignore' }).status;
  if (run('rev-parse', '--verify', head + '^{commit}') !== 0) throw new Error('Scan head unavailable.');
  if (run('rev-parse', '--verify', base + '^{commit}') !== 0) {
    if (isPush) return '--all';
    throw new Error('PR scan base unavailable.');
  }
  if (isPush) {
    const ancestor = run('merge-base', '--is-ancestor', base, head);
    if (ancestor === 1) return '--all';
    if (ancestor !== 0) throw new Error('Push ancestry unverifiable.');
  }
  return range;
}
