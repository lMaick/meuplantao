import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/session";
import { getHstsValue, HSTS_HEADER, shouldSendHsts } from "@/lib/security/hsts";

function requestHost(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.hostname ??
    ""
  );
}

function requestProto(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.nextUrl.protocol;
}

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  // MAI-146: HSTS somente no host de produção via HTTPS. Localhost, preview
  // (*.vercel.app), staging e HTTP nunca recebem o header; o redirect
  // HTTP→HTTPS é papel da Vercel/edge. `next.config.ts` propositalmente NÃO
  // emite HSTS estático (build não distingue host).
  if (shouldSendHsts({ hostname: requestHost(request), proto: requestProto(request) })) {
    response.headers.set(HSTS_HEADER, getHstsValue());
  }
  return response;
}

export const config = {
  matcher: ["/((?!robots\\.txt$|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
