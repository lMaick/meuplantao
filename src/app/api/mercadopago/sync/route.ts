import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, paymentBelongsToUser } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { captureSyncError } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";

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
  let currentUserId: string | undefined;

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    }
    currentUserId = user.id;

    const searchUrl = `${getMercadoPagoApiUrl()}/v1/payments/search?external_reference=${encodeURIComponent(user.id)}&sort=date_created&criteria=desc&limit=50`;
    const paymentResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });

    if (!paymentResponse.ok) {
      captureSyncError(new Error(`Mercado Pago search query failed with status ${paymentResponse.status}`), {
        route: "/api/mercadopago/sync",
        userId: user.id,
        httpStatus: 502,
        extra: {
          upstream_status: paymentResponse.status,
          search_stage: "user_payments_search",
        },
      });
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
      if (!packageSearchResponse.ok) {
        captureSyncError(new Error(`Mercado Pago fallback search failed with status ${packageSearchResponse.status}`), {
          route: "/api/mercadopago/sync",
          userId: user.id,
          httpStatus: 502,
          extra: {
            upstream_status: packageSearchResponse.status,
            search_stage: "fallback_payments_search",
          },
        });
        return NextResponse.json(
          { error: "Nao foi possivel consultar pagamentos no Mercado Pago" },
          { status: 502 },
        );
      }
      searchData = (await packageSearchResponse.json()) as MercadoPagoSearchResult;
      userPayments = (searchData.results || []).filter(matchesUser);
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

      const now = new Date();
      const isSubscriptionActive = Boolean(finalPeriodEnd && new Date(finalPeriodEnd) > now);
      const derivedStatus = isSubscriptionActive ? "active" : "expired";

      return NextResponse.json({
        synced: true,
        payment_found: true,
        payment_processed_now: newlyProcessedCount > 0,
        already_processed: newlyProcessedCount === 0 && uniquePayments.length > 0,
        subscription_active: isSubscriptionActive,
        subscription_status: derivedStatus,
        current_period_end: finalPeriodEnd,
        newly_processed: newlyProcessedCount,
        total_payments: uniquePayments.length,
        status: derivedStatus,
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

    const now = new Date();
    const isSubActive = Boolean(currentSub?.current_period_end && new Date(currentSub.current_period_end) > now);
    const currentStatus = isSubActive
      ? "active"
      : (currentSub?.current_period_end ? "expired" : (currentSub?.status || "trialing"));

    return NextResponse.json({
      synced: false,
      payment_found: false,
      payment_processed_now: false,
      already_processed: false,
      subscription_active: isSubActive,
      subscription_status: currentStatus,
      current_period_end: currentSub?.current_period_end || null,
      newly_processed: 0,
      total_payments: 0,
      status: currentStatus,
    });
  } catch (error) {
    captureSyncError(error, {
      route: "/api/mercadopago/sync",
      userId: currentUserId,
    });
    return NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });
  }
}
