import { createHmac, timingSafeEqual } from "node:crypto";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, getMercadoPagoWebhookSecret } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { createAdminClient } from "@/lib/stripe/supabase";

export const runtime = "nodejs";

function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function extractPaymentInfo(request: Request, rawBody: string) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  let bodyJson: {
    type?: string;
    topic?: string;
    action?: string;
    resource?: string;
    id?: string | number;
    data?: { id?: string | number };
  } = {};

  if (rawBody && rawBody.trim()) {
    try {
      bodyJson = JSON.parse(rawBody);
    } catch {
      // Ignora erro de parse de JSON se o payload for vazio ou querystring
    }
  }

  const typeOrTopic =
    searchParams.get("type") ||
    searchParams.get("topic") ||
    bodyJson.type ||
    bodyJson.topic ||
    bodyJson.action;

  let paymentId =
    searchParams.get("data.id") ||
    searchParams.get("data[id]") ||
    searchParams.get("id") ||
    searchParams.get("payment_id") ||
    searchParams.get("collection_id") ||
    bodyJson.data?.id?.toString() ||
    bodyJson.id?.toString();

  if (!paymentId && typeof bodyJson.resource === "string") {
    const match = bodyJson.resource.match(/\/payments\/(\d+)/i);
    if (match) paymentId = match[1];
  }
  if (!paymentId && typeof searchParams.get("resource") === "string") {
    const match = (searchParams.get("resource") || "").match(/\/payments\/(\d+)/i);
    if (match) paymentId = match[1];
  }

  return { typeOrTopic, paymentId, bodyJson };
}

function validSignature(request: Request, paymentId: string | undefined): boolean {
  const secret = getMercadoPagoWebhookSecret();
  const signature = request.headers.get("x-signature");

  // Se não houver assinatura ou segredo configurado, validação é delegada à API autenticada do MP
  if (!secret || !signature) return true;

  const requestId = request.headers.get("x-request-id");
  if (!requestId) return false;

  const values = new Map(
    signature
      .split(",")
      .map((part) => part.trim().split("=", 2) as [string, string]),
  );
  const timestamp = values.get("ts");
  const receivedHash = values.get("v1");

  if (!timestamp || !receivedHash || !paymentId) return false;

  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"), "utf8");
  const received = Buffer.from(receivedHash, "utf8");

  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function handleWebhook(request: Request, rawBody: string) {
  const { typeOrTopic, paymentId } = extractPaymentInfo(request, rawBody);

  // Validação de assinatura criptográfica se os cabeçalhos x-signature estiverem presentes
  if (!validSignature(request, paymentId)) {
    return Response.json({ error: "Assinatura Mercado Pago invalida" }, { status: 401 });
  }

  // Ignora eventos que comprovadamente não sejam de pagamento
  if (typeOrTopic && !typeOrTopic.toLowerCase().includes("payment") && typeOrTopic !== "payment.created" && typeOrTopic !== "payment.updated") {
    return Response.json({ received: true, ignored: true });
  }

  // Se não foi possível extrair identificador de pagamento, responde HTTP 200 com fallback gracioso
  if (!paymentId) {
    return Response.json({ received: true, ignored: true, error: "Notificacao sem identificador de pagamento" }, { status: 200 });
  }

  try {
    const paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });

    if (!paymentResponse.ok) {
      return Response.json({ received: true, ignored: true, error: "Mercado Pago nao retornou o pagamento" }, { status: 200 });
    }

    const payment = (await paymentResponse.json()) as {
      status?: string;
      external_reference?: string;
      date_created?: string;
      date_approved?: string;
      transaction_amount?: number;
      metadata?: { user_id?: string; userId?: string; months?: number };
    };

    if (payment.status !== "approved") {
      return Response.json({ received: true, ignored: true, status: payment.status ?? "unknown" }, { status: 200 });
    }

    const [externalUserId, externalMonths] = (payment.external_reference || "").split("#");
    const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

    if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
      return Response.json({ received: true, ignored: true, error: "Identificadores de usuario divergentes no pagamento" }, { status: 200 });
    }

    const userId = externalUserId || metadataUserId;
    if (!isUserId(userId)) {
      return Response.json({ received: true, ignored: true, error: "Pagamento sem usuario valido associado" }, { status: 200 });
    }

    const months = Number(payment.metadata?.months || externalMonths || 1);
    const validityDays = getValidityDays(months);

    const admin = createAdminClient();
    const result = await processMercadoPagoPayment(admin, {
      paymentId,
      userId,
      months,
      validityDays,
      amount: payment.transaction_amount,
      status: payment.status ?? "approved",
    });

    return Response.json({
      received: true,
      processed: true,
      already_processed: result.already_processed,
      current_period_end: result.current_period_end,
    }, { status: 200 });
  } catch (error) {
    console.error("Mercado Pago webhook processing error", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Nao foi possivel processar o evento Mercado Pago" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleWebhook(request, "");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return handleWebhook(request, rawBody);
}
