// Server and client helpers for the Google OAuth sign-in flow.
//
// The redirect URL sent to Supabase must point to a callback path on the
// application's own origin. The browser is then redirected back to that path
// after Google completes authentication. The callback handler under
// src/app/auth/callback/route.ts exchanges the one-time code for a session.
//
// Nothing here embeds secrets. The Google client id/secret live in the
// Supabase dashboard, not in this repository.
import { safeNext } from "@/lib/auth/redirect";

export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const OAUTH_PROVIDER = "google" as const;

export function getPublicSiteOrigin(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return isHttpOrigin(configured) ? configured : ensureOrigin(fallbackOrigin);
}

/** Build the OAuth callback URL relative to the current request origin. */
export function buildOAuthCallbackUrl(origin: string): string {
  return new URL(OAUTH_CALLBACK_PATH, ensureOrigin(origin)).toString();
}

/** Resolve the post-OAuth destination, falling back to the dashboard. */
export function resolveOAuthNext(value?: string | string[]): string {
  return safeNext(value);
}

function ensureOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    if (isHttpOrigin(parsed.toString())) {
      return parsed.origin;
    }
  } catch {
    // Fall through to the relative-path branch below.
  }
  return "http://localhost";
}

function isHttpOrigin(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username && !parsed.password && parsed.pathname === "/" &&
      !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}
