import { NextResponse, type NextRequest } from "next/server";
import { getApplicationOrigin, getMonthlyPriceId, getStripeClient } from "@/lib/stripe/config";
import { createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/dashboard", request.url), 303);
  try {
    const supabase = createAuthenticatedClient(request, response);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });

    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("status, stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (subscription?.stripe_subscription_id && ["trialing", "active", "past_due"].includes(subscription.status)) {
      return NextResponse.json({ error: "Ja existe uma assinatura para este usuario" }, { status: 409 });
    }

    const origin = getApplicationOrigin(request.url);
    const session = await getStripeClient().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: getMonthlyPriceId(), quantity: 1 }],
      customer: subscription?.stripe_customer_id ?? undefined,
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/configuracoes?stripe=success`,
      cancel_url: `${origin}/configuracoes?stripe=cancelled`,
    });
    if (!session.url) throw new Error("Stripe nao retornou URL de checkout");
    response.headers.set("location", session.url);
    return response;
  } catch (error) {
    console.error("Stripe checkout error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel iniciar o checkout" }, { status: 500 });
  }
}
