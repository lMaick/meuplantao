import Stripe from "stripe";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe/config";
import { createAdminClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

const supportedEvents = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid";

function asId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function normalizeStatus(status: string, deleted = false): SubscriptionStatus {
  if (deleted || status === "incomplete_expired") return "canceled";
  if (status === "incomplete") return "past_due";
  if (status === "paused") return "unpaid";
  if (["trialing", "active", "past_due", "canceled", "unpaid"].includes(status)) return status as SubscriptionStatus;
  throw new Error("Status Stripe nao suportado");
}

function subscriptionPayload(subscription: Stripe.Subscription, deleted = false) {
  const periodEnds = subscription.items.data.map((item) => item.current_period_end).filter((value): value is number => typeof value === "number");
  const currentPeriodEnd = periodEnds.length > 0 ? new Date(Math.min(...periodEnds) * 1000).toISOString() : null;
  return {
    userId: subscription.metadata.user_id || null,
    customerId: asId(subscription.customer),
    subscriptionId: subscription.id,
    priceId: subscription.items.data[0]?.price.id ?? null,
    status: normalizeStatus(subscription.status, deleted),
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

async function payloadForEvent(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = asId(session.subscription);
    if (!subscriptionId) throw new Error("Checkout sem assinatura Stripe");
    const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
    const payload = subscriptionPayload(subscription);
    return { ...payload, userId: session.metadata?.user_id || session.client_reference_id || payload.userId };
  }

  const subscription = event.data.object as Stripe.Subscription;
  return subscriptionPayload(subscription, event.type === "customer.subscription.deleted");
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Assinatura Stripe ausente" }, { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = getStripeClient().webhooks.constructEvent(body, signature, getStripeWebhookSecret());
  } catch {
    return Response.json({ error: "Assinatura Stripe invalida" }, { status: 400 });
  }

  if (!supportedEvents.has(event.type)) return Response.json({ received: true, ignored: true });

  try {
    const payload = await payloadForEvent(event);
    const { data, error } = await createAdminClient().rpc("process_stripe_subscription_event", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_user_id: payload.userId,
      p_stripe_customer_id: payload.customerId,
      p_stripe_subscription_id: payload.subscriptionId,
      p_stripe_price_id: payload.priceId,
      p_status: payload.status,
      p_current_period_end: payload.currentPeriodEnd,
      p_cancel_at_period_end: payload.cancelAtPeriodEnd,
    });
    if (error) throw error;
    return Response.json({ received: true, processed: data !== false });
  } catch (error) {
    console.error("Stripe webhook processing error", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Nao foi possivel processar o evento Stripe" }, { status: 500 });
  }
}
