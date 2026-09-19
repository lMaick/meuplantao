import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { createAdminClient, createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

interface MercadoPagoSearchResult {
  results?: Array<{
    id?: string | number;
    status?: string;
    external_reference?: string;
    date_created?: string;
    metadata?: { user_id?: string; userId?: string };
  }>;
}

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    }

    const searchUrl = `${getMercadoPagoApiUrl()}/v1/payments/search?external_reference=${encodeURIComponent(user.id)}&sort=date_created&criteria=desc&limit=5`;
    const paymentResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });

    if (!paymentResponse.ok) {
      return NextResponse.json(
        { error: "Nao foi possivel consultar pagamentos no Mercado Pago" },
        { status: 502 },
      );
    }

    const searchData = (await paymentResponse.json()) as MercadoPagoSearchResult;
    const approvedPayment = (searchData.results || []).find((p) => p.status === "approved");

    if (approvedPayment) {
      const { error: subError } = await createAdminClient().from("subscriptions").upsert(
        { user_id: user.id, status: "active" },
        { onConflict: "user_id" },
      );
      if (subError) throw subError;

      return NextResponse.json({ synced: true, status: "active" });
    }

    // Se nenhum pagamento aprovado foi encontrado, consulta o status atual
    const { data: currentSub } = await createAdminClient()
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const currentStatus = currentSub?.status || "trialing";
    return NextResponse.json({ synced: false, status: currentStatus });
  } catch (error) {
    console.error("Mercado Pago sync error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });
  }
}
