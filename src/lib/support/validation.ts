export interface SupportSubmission {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export type SupportValidation =
  | { ok: true; data: SupportSubmission }
  | { ok: false; reason: "required" | "email" | "length" };

export function validateSupportSubmission(value: unknown): SupportValidation {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "required" };
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const subject = typeof input.subject === "string" ? input.subject.trim().replace(/[\r\n]+/g, " ") : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";

  if (!name || !email || !subject || !message) return { ok: false, reason: "required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "email" };
  if (name.length > 100 || email.length > 254 || subject.length > 120 || message.length > 5000) {
    return { ok: false, reason: "length" };
  }

  return { ok: true, data: { name, email, subject, message } };
}
