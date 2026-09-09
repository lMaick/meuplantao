export function newIdempotencyKey(): string {
  const candidate = (globalThis as { crypto?: Crypto }).crypto;
  if (candidate && typeof candidate.randomUUID === "function") return candidate.randomUUID();
  const bytes = new Uint8Array(16);
  if (candidate && typeof candidate.getRandomValues === "function") {
    candidate.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function startNewShiftIntent(): string {
  return newIdempotencyKey();
}

export function keyForShiftSave(isNew: boolean, storedKey: string | null): string | null {
  if (!isNew) return null;
  return storedKey ?? newIdempotencyKey();
}
