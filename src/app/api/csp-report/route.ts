import { NextResponse, type NextRequest } from "next/server";
import {
  checkCspReportRateLimit,
  CSP_REPORT_MAX_BYTES,
  isAllowedCspContentType,
  normalizeCspReportIp,
  sanitizeCspReport,
} from "@/lib/security/csp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/csp-report";

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return normalizeCspReportIp(forwarded);
  const real = request.headers.get("x-real-ip");
  if (real) return normalizeCspReportIp(real);
  return "unknown";
}

function methodNotAllowed() {
  return NextResponse.json({ error: "method-not-allowed" }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isAllowedCspContentType(contentType)) {
    return NextResponse.json({ error: "unsupported-media-type" }, { status: 415 });
  }

  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > CSP_REPORT_MAX_BYTES) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "invalid-report" }, { status: 400 });
  }
  if (!raw || raw.length > CSP_REPORT_MAX_BYTES) {
    return NextResponse.json({ error: raw ? "payload-too-large" : "invalid-report" }, { status: raw ? 413 : 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid-report" }, { status: 400 });
  }

  const sanitized = sanitizeCspReport(parsed);
  if (!sanitized.ok) {
    return NextResponse.json({ error: "invalid-report" }, { status: 400 });
  }

  const { allowed, retryAfterSeconds } = checkCspReportRateLimit(clientIp(request));
  if (!allowed) {
    return NextResponse.json(
      { error: "rate-limited" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  // Log estruturado — SOMENTE campos sanitizados (sem IP, UA, cookies, tokens).
  console.warn(JSON.stringify({ event: "csp_violation", route: ROUTE, ...sanitized.report }));

  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function OPTIONS() {
  return methodNotAllowed();
}
