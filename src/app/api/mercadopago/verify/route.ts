import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, paymentBelongsToUser } from "@/lib/mercadopago/config";
import { createAdminClient, createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

const validityDaysByMonths = new Map([[1, 30], [3, 90], [6, 180], [12, 365]]);

function addValidity(start: Date, days: number): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return end;
}

interface MercadoPagoPayment {
  status?: string;
  external_reference?: string;
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
    const validityDays = validityDaysByMonths.get(months) ?? validityDaysByMonths.get(1)!;

    const admin = createAdminClient();
    const subscriptionTable = admin.from("subscriptions");
    const { data: currentSubscription } = await subscriptionTable.select("current_period_end").eq("user_id", user.id).maybeSingle();
    const currentEnd = currentSubscription?.current_period_end ? new Date(currentSubscription.current_period_end) : new Date();
    const start = currentEnd > new Date() ? currentEnd : new Date();
    const currentPeriodEnd = addValidity(start, validityDays).toISOString();

    const { error: subscriptionError } = await admin.from("subscriptions").upsert(
      { user_id: user.id, status: "active", current_period_end: currentPeriodEnd },
      { onConflict: "user_id" },
    );
    if (subscriptionError) throw subscriptionError;

    return NextResponse.json({ verified: true, activated: true, status: "active", current_period_end: currentPeriodEnd });
  } catch (error) {
    console.error("Mercado Pago verification error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel conciliar o pagamento" }, { status: 500 });
  }
}
