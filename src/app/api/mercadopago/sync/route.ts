import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { createAdminClient, createAuthenticatedClient } from "@/lib/stripe/supabase";
import { calculateCumulativePeriodEnd } from "@/lib/subscription/trial";

export const runtime = "nodejs";

interface MercadoPagoSearchResult {
  results?: Array<{
    id?: string | number;
    status?: string;
    external_reference?: string;
    date_created?: string;
    date_approved?: string;
    transaction_amount?: number;
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

    const searchUrl = `${getMercadoPagoApiUrl()}/v1/payments/search?external_reference=${encodeURIComponent(user.id)}&sort=date_created&criteria=desc&limit=50`;
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
    const userPayments = (searchData.results || []).filter((p) => {
      if (p.status !== "approved") return false;
      const ref = p.external_reference || p.metadata?.user_id || p.metadata?.userId;
      // Aceita pagamentos sem referência quando a busca já filtrou por external_reference,
      // e pagamentos cuja referência/metadata pertence ao usuário autenticado.
      return !ref || ref === user.id;
    });

    // MAI-126: vigência cumulativa — cada pagamento aprovado de R$ 12,90 = +30 dias.
    const currentPeriodEnd = calculateCumulativePeriodEnd(userPayments, new Date());

    if (currentPeriodEnd) {
      const { error: subError } = await createAdminClient().from("subscriptions").upsert(
        { user_id: user.id, status: "active", current_period_end: currentPeriodEnd },
        { onConflict: "user_id" },
      );
      if (subError) throw subError;

      return NextResponse.json({ synced: true, status: "active", current_period_end: currentPeriodEnd });
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
