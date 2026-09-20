import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, paymentBelongsToUser } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { createAdminClient, createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

interface MercadoPagoSearchResult {
  results?: Array<{
    id?: string | number;
    status?: string;
    external_reference?: string;
    date_created?: string;
    date_approved?: string;
    transaction_amount?: number;
    metadata?: { user_id?: string; userId?: string; months?: number };
  }>;
}

export { paymentBelongsToUser };

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

    const matchesUser = (p: NonNullable<MercadoPagoSearchResult["results"]>[number]) => {
      if (p.status !== "approved") return false;
      return paymentBelongsToUser(p, user.id);
    };

    let searchData = (await paymentResponse.json()) as MercadoPagoSearchResult;
    let userPayments = (searchData.results || []).filter(matchesUser);

    if (userPayments.length === 0) {
      const packageSearchResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/search?sort=date_created&criteria=desc&limit=50`, {
        headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
      });
      if (packageSearchResponse.ok) {
        searchData = (await packageSearchResponse.json()) as MercadoPagoSearchResult;
        userPayments = (searchData.results || []).filter(matchesUser);
      }
    }

    if (userPayments.length > 0) {
      // Deduplica por ID de pagamento
      const uniquePaymentsMap = new Map<string, NonNullable<MercadoPagoSearchResult["results"]>[number]>();
      for (const p of userPayments) {
        if (p.id) {
          uniquePaymentsMap.set(String(p.id), p);
        }
      }
      const uniquePayments = Array.from(uniquePaymentsMap.values());

      // Ordena cronologicamente (do mais antigo para o mais novo) para aplicar na ordem de aquisição
      uniquePayments.sort((a, b) => {
        const timeA = new Date(a.date_approved || a.date_created || 0).getTime();
        const timeB = new Date(b.date_approved || b.date_created || 0).getTime();
        return timeA - timeB;
      });

      const admin = createAdminClient();
      let newlyProcessedCount = 0;
      let lastResultPeriodEnd: string | null = null;

      for (const p of uniquePayments) {
        const paymentId = String(p.id);
        const months = Number(p.metadata?.months || p.external_reference?.split("#")[1] || 1);
        const validityDays = getValidityDays(months);

        const result = await processMercadoPagoPayment(admin, {
          paymentId,
          userId: user.id,
          months,
          validityDays,
          amount: p.transaction_amount,
          status: p.status ?? "approved",
        });

        if (!result.already_processed) {
          newlyProcessedCount += 1;
        }
        lastResultPeriodEnd = result.current_period_end;
      }

      // Consulta o registro atualizado da assinatura
      let currentSub = null;
      try {
        const subQuery = admin.from("subscriptions");
        if (typeof subQuery?.select === "function") {
          const { data } = await subQuery
            .select("status, current_period_end")
            .eq("user_id", user.id)
            .maybeSingle();
          currentSub = data;
        }
      } catch {
        // Fallback gracioso
      }

      const finalPeriodEnd = currentSub?.current_period_end || lastResultPeriodEnd;

      return NextResponse.json({
        synced: true,
        status: currentSub?.status || "active",
        current_period_end: finalPeriodEnd,
        newly_processed: newlyProcessedCount,
        total_payments: uniquePayments.length,
      });
    }

    // Se nenhum pagamento aprovado foi encontrado, consulta o status atual
    let currentSub = null;
    try {
      const subQuery = createAdminClient().from("subscriptions");
      if (typeof subQuery?.select === "function") {
        const { data } = await subQuery
          .select("status, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle();
        currentSub = data;
      }
    } catch {
      // Fallback
    }

    const currentStatus = currentSub?.status || "trialing";
    return NextResponse.json({
      synced: false,
      status: currentStatus,
      ...(currentSub?.current_period_end ? { current_period_end: currentSub.current_period_end } : {}),
    });
  } catch (error) {
    console.error("Mercado Pago sync error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });
  }
}
