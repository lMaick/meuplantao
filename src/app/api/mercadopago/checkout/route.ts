import { NextResponse, type NextRequest } from "next/server";
import { getApplicationOrigin, getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

const PLAN_PRICE = 12.9;

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ error: "Nao foi possivel iniciar o checkout" }, { status: 500 });

  try {
    const supabase = createAuthenticatedClient(request, response);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });

    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (subscription && ["trialing", "active", "past_due"].includes(subscription.status)) {
      return NextResponse.json({ error: "Ja existe uma assinatura para este usuario" }, { status: 409 });
    }

    const origin = getApplicationOrigin(request.url);
    const isHttps = origin.startsWith("https://");
    const mercadoPagoResponse = await fetch(`${getMercadoPagoApiUrl()}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: "meuplantao-pro", title: "MeuPlantão Pro", description: "Assinatura mensal do MeuPlantão Pro", quantity: 1, currency_id: "BRL", unit_price: PLAN_PRICE }],
        external_reference: user.id,
        payer: user.email ? { email: user.email } : undefined,
        back_urls: {
          success: `${origin}/configuracoes?payment=success`,
          pending: `${origin}/configuracoes?payment=pending`,
          failure: `${origin}/configuracoes?payment=failure`,
        },
        auto_return: isHttps ? "approved" : undefined,
        notification_url: isHttps ? `${origin}/api/webhooks/mercadopago` : undefined,
      }),
    });

    if (!mercadoPagoResponse.ok) throw new Error("Mercado Pago rejeitou a preferencia");
    const preference = await mercadoPagoResponse.json() as { init_point?: string; sandbox_init_point?: string };
    const initPoint = preference.init_point || preference.sandbox_init_point;
    if (!initPoint) throw new Error("Mercado Pago nao retornou URL de checkout");
    return NextResponse.json({ init_point: initPoint });
  } catch (error) {
    console.error("Mercado Pago checkout error", error instanceof Error ? error.message : "unknown");
    return response;
  }
}
