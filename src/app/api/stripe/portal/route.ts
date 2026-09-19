import { NextResponse, type NextRequest } from "next/server";
import { getApplicationOrigin, getStripeClient } from "@/lib/stripe/config";
import { createAuthenticatedClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/dashboard", request.url), 303);
  try {
    const supabase = createAuthenticatedClient(request, response);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!subscription?.stripe_customer_id) return NextResponse.json({ error: "Nenhuma assinatura Stripe encontrada" }, { status: 404 });

    const session = await getStripeClient().billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${getApplicationOrigin(request.url)}/configuracoes`,
    });
    response.headers.set("location", session.url);
    return response;
  } catch (error) {
    console.error("Stripe portal error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel abrir o portal Stripe" }, { status: 500 });
  }
}
