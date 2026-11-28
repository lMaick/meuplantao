import { NextResponse, type NextRequest } from "next/server";
import { captureError } from "@/lib/observability";
import { allowSupportSubmission } from "@/lib/support/rate-limit";
import { validateSupportSubmission } from "@/lib/support/validation";

export const runtime = "nodejs";

const SUPPORT_EMAIL = "contato@meuplantao.pro";
const DEFAULT_FROM = "MeuPlantão <avisos@meuplantao.pro>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function clientKey(request: NextRequest): string {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export async function POST(request: NextRequest) {
  if (!allowSupportSubmission(clientKey(request))) {
    return NextResponse.json(
      { error: "Muitas mensagens em pouco tempo. Tente novamente em alguns minutos." },
      { status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" } },
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Revise os campos e tente novamente." }, { status: 400 });
  }

  const body = typeof input === "object" && input !== null ? input as Record<string, unknown> : null;
  if (typeof body?.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const validated = validateSupportSubmission(input);
  if (!validated.ok) {
    const messages = {
      required: "Preencha todos os campos para enviar sua mensagem.",
      email: "Informe um endereço de e-mail válido.",
      length: "Um dos campos ultrapassou o limite permitido.",
    } as const;
    return NextResponse.json({ error: messages[validated.reason] }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "O envio pelo site ainda não está configurado. Escreva para contato@meuplantao.pro." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { name, email, subject, message } = validated.data;
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM?.trim() || DEFAULT_FROM,
        to: [SUPPORT_EMAIL],
        reply_to: email,
        subject: `Suporte MeuPlantão: ${subject}`,
        text: `Nome: ${name}\nE-mail: ${email}\n\n${message}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      captureError(new Error(`support_email_http_${response.status}`), {
        route: "/api/support",
        level: "warning",
        httpStatus: response.status,
      });
      return NextResponse.json(
        { error: "Não foi possível enviar agora. Tente novamente ou escreva para contato@meuplantao.pro." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    captureError(error, { route: "/api/support", level: "error", httpStatus: 502 });
    return NextResponse.json(
      { error: "Não foi possível enviar agora. Tente novamente ou escreva para contato@meuplantao.pro." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
