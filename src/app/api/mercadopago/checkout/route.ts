import { NextResponse, type NextRequest } from "next/server";
import { getApplicationOrigin, getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

const periods = new Map([
  [1, { months: 1, label: "Mensal", price: 12.9, validityDays: 30 }],
  [3, { months: 3, label: "Trimestral", price: 38.7, validityDays: 90 }],
  [6, { months: 6, label: "Semestral", price: 69.9, validityDays: 180 }],
  [12, { months: 12, label: "Anual", price: 129.9, validityDays: 365 }],
]);

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ error: "Nao foi possivel iniciar o checkout" }, { status: 500 });

  try {
    const supabase = createAuthenticatedClient(request, response);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });

    let subscription = null;
    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error) subscription = data;
    } catch {
      // Subscriptions table might not be migrated yet in remote db
    }

    const isRenewal = Boolean(subscription && subscription.status === "active");

    let months = 1;
    let requestedPeriod = false;
    try {
      const body = (await request.json()) as { months?: number };
      requestedPeriod = body.months !== undefined;
      months = body.months ?? 1;
    } catch {
      months = 1;
    }
    const period = periods.get(months);
    if (!period) return NextResponse.json({ error: "Periodo de assinatura invalido" }, { status: 400 });

    const origin = getApplicationOrigin(request.url);
    const isHttps = origin.startsWith("https://");
    const mercadoPagoResponse = await fetch(`${getMercadoPagoApiUrl()}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{
          id: `meuplantao-pro-${period.months}`,
          title: `MeuPlantão Pro — ${period.label}`,
          description: `${isRenewal ? "Renovação" : "Assinatura"} do MeuPlantão Pro por ${period.validityDays} dias`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: period.price,
        }],
        external_reference: requestedPeriod ? `${user.id}#${period.months}` : user.id,
        metadata: { user_id: user.id, months: period.months, is_renewal: isRenewal },
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
