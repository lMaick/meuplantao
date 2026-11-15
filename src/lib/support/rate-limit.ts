const WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMISSIONS = 5;
const entries = new Map<string, { count: number; resetAt: number }>();

export function allowSupportSubmission(key: string, now = Date.now()): boolean {
  const current = entries.get(key);
  if (current && current.resetAt > now && current.count >= MAX_SUBMISSIONS) return false;

  if (!current || current.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entries.set(key, { count: current.count + 1, resetAt: current.resetAt });
  }

  if (entries.size > 1000) {
    for (const [entryKey, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(entryKey);
    }
    while (entries.size > 1000) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }
  return true;
}

export function resetSupportRateLimitForTesting(): void {
  entries.clear();
}
