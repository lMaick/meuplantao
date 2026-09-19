import { createHmac, timingSafeEqual } from "node:crypto";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, getMercadoPagoWebhookSecret } from "@/lib/mercadopago/config";
import { createAdminClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

function validSignature(rawBody: string, request: Request): boolean {
  const secret = getMercadoPagoWebhookSecret();
  if (!secret) return true;
  const signature = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  if (!signature || !requestId) return false;
  const values = new Map(signature.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const timestamp = values.get("ts");
  const receivedHash = values.get("v1");
  let notificationId: string | undefined;
  try {
    const body = JSON.parse(rawBody) as { data?: { id?: string | number } };
    notificationId = body.data?.id?.toString();
  } catch {
    return false;
  }
  if (!timestamp || !receivedHash || !notificationId) return false;
  const manifest = `id:${notificationId};request-id:${requestId};ts:${timestamp};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"), "utf8");
  const received = Buffer.from(receivedHash, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validSignature(rawBody, request)) return Response.json({ error: "Assinatura Mercado Pago invalida" }, { status: 401 });

  let notification: { type?: string; topic?: string; data?: { id?: string | number } };
  try {
    notification = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Payload Mercado Pago invalido" }, { status: 400 });
  }
  if (notification.type !== "payment" && notification.topic !== "payment") return Response.json({ received: true, ignored: true });

  const paymentId = notification.data?.id?.toString();
  if (!paymentId) return Response.json({ error: "Notificacao sem pagamento" }, { status: 400 });

  try {
    const paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });
    if (!paymentResponse.ok) throw new Error("Mercado Pago nao retornou o pagamento");
    const payment = await paymentResponse.json() as { status?: string; external_reference?: string };
    if (payment.status !== "approved") return Response.json({ received: true, ignored: true });
    if (!isUserId(payment.external_reference)) throw new Error("Pagamento sem usuario associado");

    const { error } = await createAdminClient().from("subscriptions").upsert(
      { user_id: payment.external_reference, status: "active" },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return Response.json({ received: true, processed: true });
  } catch (error) {
    console.error("Mercado Pago webhook processing error", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Nao foi possivel processar o evento Mercado Pago" }, { status: 500 });
  }
}
