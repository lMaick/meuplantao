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

export function keyForShiftSave(isNew: boolean, intent: ShiftCreationIntent | null): string | null {
  if (!isNew) return null;
  if (intent === null) throw new Error("criacao de plantao exige intent de idempotencia");
  return intent.keyForSubmit();
}

export class ShiftCreationIntent {
  private activeKey: string | null;
  private constructor(key: string) {
    this.activeKey = key;
  }
  static begin(): ShiftCreationIntent {
    return new ShiftCreationIntent(startNewShiftIntent());
  }
  keyForSubmit(): string {
    if (this.activeKey === null) throw new Error("intent de criacao descartada");
    return this.activeKey;
  }
  get isActive(): boolean {
    return this.activeKey !== null;
  }
  markSucceeded(): void {
    this.activeKey = null;
  }
  markCancelled(): void {
    this.activeKey = null;
  }
}
