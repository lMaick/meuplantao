import { NextResponse, type NextRequest } from "next/server";
import { deleteAccount, isDeleteConfirmation } from "@/lib/account/delete-account";
import { captureError } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/account/delete";
const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** Exclusão definitiva da própria conta. Sem desfazer. */
export async function POST(request: NextRequest) {
  // Operação destrutiva: só aceita chamada da própria página (anti-CSRF).
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return fail(403, "Pedido não permitido.");
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return fail(415, "Pedido inválido.");
  }

  const body = (await request.json().catch(() => null)) as { confirmacao?: unknown } | null;
  if (!isDeleteConfirmation(body?.confirmacao)) {
    return fail(400, "Digite EXCLUIR para confirmar.");
  }

  let userId: string | undefined;
  try {
    const { data, error } = await createAuthenticatedClient(request, NextResponse.next()).auth.getUser();
    if (error || !data.user) {
      return fail(401, "Sua sessão expirou. Entre novamente para excluir a conta.");
    }
    userId = data.user.id;
    await deleteAccount(createAdminClient(), userId);
  } catch (error) {
    captureError(error, {
      route: ROUTE,
      rpcName: "delete_account",
      userId,
      level: "error",
      httpStatus: 500,
    });
    return fail(
      500,
      "Não foi possível confirmar a exclusão. Tente novamente ou escreva para contato@meuplantao.pro.",
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  for (const { name } of request.cookies.getAll()) {
    if (name.startsWith("sb-")) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
