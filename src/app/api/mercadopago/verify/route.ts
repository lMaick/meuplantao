import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { createAdminClient, createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

interface MercadoPagoPayment {
  status?: string;
  external_reference?: string;
  metadata?: { user_id?: string };
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

    const payment = await paymentResponse.json() as MercadoPagoPayment;
    if (payment.status !== "approved") {
      return NextResponse.json({ verified: true, activated: false, status: payment.status ?? "unknown" });
    }

    const paymentUserId = payment.external_reference || payment.metadata?.user_id;
    if (paymentUserId !== user.id) {
      return NextResponse.json({ error: "Pagamento nao pertence a esta conta" }, { status: 403 });
    }

    const { error: subscriptionError } = await createAdminClient().from("subscriptions").upsert(
      { user_id: user.id, status: "active" },
      { onConflict: "user_id" },
    );
    if (subscriptionError) throw subscriptionError;

    return NextResponse.json({ verified: true, activated: true, status: "active" });
  } catch (error) {
    console.error("Mercado Pago verification error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel conciliar o pagamento" }, { status: 500 });
  }
}
