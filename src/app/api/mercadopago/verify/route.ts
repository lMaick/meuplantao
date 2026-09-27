import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, paymentBelongsToUser } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { captureError } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface MercadoPagoPayment {
  id?: string | number;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  metadata?: { user_id?: string; userId?: string; months?: number };
}

function getPaymentId(request: NextRequest): string | null {
  const paymentId = request.nextUrl.searchParams.get("payment_id")?.trim();
  const collectionId = request.nextUrl.searchParams.get("collection_id")?.trim();
  const identifier = paymentId || collectionId;
  return identifier && identifier.length <= 200 ? identifier : null;
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.json({ error: "Nao foi possivel verificar o pagamento" }, { status: 500 });
  const requestedPaymentId = getPaymentId(request);
  let currentUserId: string | undefined;

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    currentUserId = user.id;

    const paymentId = getPaymentId(request);
    if (!paymentId) return NextResponse.json({ error: "Identificador do pagamento ausente" }, { status: 400 });

    const paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });
    if (!paymentResponse.ok) {
      captureError(new Error(`Mercado Pago verify query failed with status ${paymentResponse.status}`), {
        route: "/api/mercadopago/verify",
        userId: user.id,
        paymentId,
        httpStatus: 502,
        extra: {
          upstream_status: paymentResponse.status,
        },
      });
      return NextResponse.json({ error: "Nao foi possivel consultar o pagamento no Mercado Pago" }, { status: 502 });
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPayment;

    if (!paymentBelongsToUser(payment, user.id)) {
      return NextResponse.json({ error: "Pagamento nao pertence a esta conta" }, { status: 403 });
    }

    if (payment.status !== "approved") {
      let currentSub = null;
      try {
        const admin = createAdminClient();
        const { data } = await admin
          .from("subscriptions")
          .select("status, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle();
        currentSub = data;
      } catch {
        // Fallback gracioso
      }

      const now = new Date();
      const isSubActive = Boolean(currentSub?.current_period_end && new Date(currentSub.current_period_end) > now);
      const subStatus = isSubActive ? "active" : (currentSub?.status || payment.status || "pending");

      return NextResponse.json({
        verified: true,
        payment_found: true,
        payment_processed_now: false,
        already_processed: false,
        subscription_active: isSubActive,
        subscription_status: subStatus,
        current_period_end: currentSub?.current_period_end || null,
        payment_status: payment.status ?? "unknown",
        activated: false,
        status: payment.status ?? "unknown",
      });
    }

    const months = Number(payment.metadata?.months || payment.external_reference?.split("#")[1] || 1);
    const validityDays = getValidityDays(months);

    const admin = createAdminClient();
    const result = await processMercadoPagoPayment(admin, {
      paymentId,
      userId: user.id,
      months,
      validityDays,
      amount: payment.transaction_amount,
      status: payment.status ?? "approved",
    });

    const now = new Date();
    const hasFutureEnd = Boolean(result.current_period_end && new Date(result.current_period_end) > now);
    const subscriptionActive = hasFutureEnd;
    const subscriptionStatus = hasFutureEnd ? "active" : "expired";
    const paymentProcessedNow = !result.already_processed;
    const isAlreadyProcessed = Boolean(result.already_processed);

    return NextResponse.json({
      verified: true,
      payment_found: true,
      payment_processed_now: paymentProcessedNow,
      already_processed: isAlreadyProcessed,
      subscription_active: subscriptionActive,
      subscription_status: subscriptionStatus,
      current_period_end: result.current_period_end,
      payment_status: payment.status ?? "approved",
      // Retrocompatibilidade
      activated: subscriptionActive,
      status: subscriptionStatus,
    });
  } catch (error) {
    captureError(error, {
      route: "/api/mercadopago/verify",
      userId: currentUserId,
      paymentId: requestedPaymentId || undefined,
      httpStatus: 500,
    });
    return NextResponse.json({ error: "Nao foi possivel conciliar o pagamento" }, { status: 500 });
  }
}
