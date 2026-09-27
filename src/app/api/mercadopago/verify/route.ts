import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, paymentBelongsToUser } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
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

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });

    const paymentId = getPaymentId(request);
    if (!paymentId) return NextResponse.json({ error: "Identificador do pagamento ausente" }, { status: 400 });

    const paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });
    if (!paymentResponse.ok) {
      return NextResponse.json({ error: "Nao foi possivel consultar o pagamento no Mercado Pago" }, { status: 502 });
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPayment;
    if (payment.status !== "approved") {
      return NextResponse.json({ verified: true, activated: false, status: payment.status ?? "unknown" });
    }

    if (!paymentBelongsToUser(payment, user.id)) {
      return NextResponse.json({ error: "Pagamento nao pertence a esta conta" }, { status: 403 });
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

    return NextResponse.json({
      verified: true,
      activated: !result.already_processed,
      status: result.status,
      already_processed: result.already_processed,
      current_period_end: result.current_period_end,
    });
  } catch (error) {
    console.error("Mercado Pago verification error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel conciliar o pagamento" }, { status: 500 });
  }
}
