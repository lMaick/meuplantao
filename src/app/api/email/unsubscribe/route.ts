import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { captureError } from "@/lib/observability";
import { isWellFormedUnsubscribeToken } from "@/lib/notifications/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/email/unsubscribe";

async function readToken(request: NextRequest): Promise<{ token: string | null; fromPage: boolean }> {
  let token = request.nextUrl.searchParams.get("token");
  let fromPage = false;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const formToken = form.get("token");
      if (!token && typeof formToken === "string") token = formToken;
      fromPage = form.get("from_page") === "1";
    } catch {
      // corpo ilegível: segue com o token da query, se houver
    }
  }
  return { token, fromPage };
}

/**
 * Descadastro em um clique, sem login. Só POST altera estado: o GET não existe
 * (405), porque leitores de e-mail pré-abrem links. Atende o botão da página
 * `/descadastrar` e o `List-Unsubscribe-Post` (RFC 8058).
 * A resposta é a mesma para token válido, inexistente ou malformado.
 */
export async function POST(request: NextRequest) {
  const { token, fromPage } = await readToken(request);
  let failed = false;

  if (isWellFormedUnsubscribeToken(token)) {
    try {
      const { error } = await createAdminClient()
        .from("email_notification_settings")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("unsubscribe_token", token.toLowerCase());
      if (error) throw error;
    } catch (error) {
      failed = true;
      captureError(error, { route: ROUTE, level: "error", httpStatus: 500 });
    }
  }

  if (fromPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/descadastrar";
    url.search = `?status=${failed ? "error" : "ok"}`;
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(failed ? { error: "internal_error" } : { ok: true }, {
    status: failed ? 500 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
