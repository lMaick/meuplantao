import { NextResponse, type NextRequest } from "next/server";
import { getApplicationOrigin, getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { captureCheckoutError } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";
import { getCanonicalPlanByMonths } from "@/lib/mercadopago/payments";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ error: "Nao foi possivel iniciar o checkout" }, { status: 500 });
  let currentUserId: string | undefined;

  try {
    const supabase = createAuthenticatedClient(request, response);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    currentUserId = user.id;

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
    try {
      const body = (await request.json()) as { months?: number };
      months = body.months ?? 1;
    } catch {
      months = 1;
    }

    const plan = getCanonicalPlanByMonths(months);
    if (!plan) return NextResponse.json({ error: "Periodo de assinatura invalido" }, { status: 400 });

    const checkoutId = crypto.randomUUID();
    const admin = createAdminClient();

    // Persistência da intenção de checkout e cotação no servidor
    try {
      if (typeof admin?.from === "function") {
        await admin.from("subscription_checkouts").insert({
          id: checkoutId,
          user_id: user.id,
          plan_id: plan.id,
          months: plan.months,
          validity_days: plan.validityDays,
          amount: plan.price,
          amount_cents: plan.priceCents,
          currency: plan.currency,
          catalog_version: plan.catalogVersion,
          status: "pending",
          metadata: { is_renewal: isRenewal },
        });
      }
    } catch {
      // Falha defensiva se tabela de checkouts ainda não estiver migrada
    }

    const origin = getApplicationOrigin(request.url);
    const isHttps = origin.startsWith("https://");
    const mercadoPagoResponse = await fetch(`${getMercadoPagoApiUrl()}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{
          id: plan.id,
          title: `MeuPlantão Pro — ${plan.label}`,
          description: `${isRenewal ? "Renovação" : "Assinatura"} do MeuPlantão Pro por ${plan.validityDays} dias`,
          quantity: 1,
          currency_id: plan.currency,
          unit_price: plan.price,
        }],
        external_reference: user.id,
        metadata: {
          user_id: user.id,
          checkout_id: checkoutId,
          plan_id: plan.id,
          months: plan.months,
          currency: plan.currency,
          price: plan.price,
          price_cents: plan.priceCents,
          catalog_version: plan.catalogVersion,
          is_renewal: isRenewal,
        },
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
    const preference = await mercadoPagoResponse.json() as { id?: string; init_point?: string; sandbox_init_point?: string };
    const initPoint = preference.init_point || preference.sandbox_init_point;
    if (!initPoint) throw new Error("Mercado Pago nao retornou URL de checkout");

    // Atualiza a referência de preference_id no registro do checkout
    if (preference.id && typeof admin?.from === "function") {
      try {
        await admin
          .from("subscription_checkouts")
          .update({ preference_id: preference.id, init_point: initPoint })
          .eq("id", checkoutId);
      } catch {
        // Silencia erro secundário de update
      }
    }

    return NextResponse.json({ init_point: initPoint });
  } catch (error) {
    captureCheckoutError(error, {
      route: "/api/mercadopago/checkout",
      userId: currentUserId,
    });
    return response;
  }
}
