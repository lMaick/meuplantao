import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { extractPaymentInfo } from "@/lib/mercadopago/webhook";
import { captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";


function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

/**
 * Handler legado para notificações IPN do Mercado Pago (sem cabeçalho x-signature).
 * A autenticidade é validada exclusivamente via consulta direta à API autenticada do Mercado Pago.
 */
async function handleLegacyIpn(request: Request, rawBody: string) {
  const { typeOrTopic, paymentId } = extractPaymentInfo(request, rawBody);

  // Ignora tópicos que não são de pagamento
  if (typeOrTopic && !typeOrTopic.toLowerCase().includes("payment") && typeOrTopic !== "payment.created" && typeOrTopic !== "payment.updated") {
    return Response.json({ received: true, ignored: true });
  }

  if (!paymentId) {
    return Response.json({ received: true, ignored: true, error: "IPN sem identificador de pagamento" }, { status: 200 });
  }

  try {
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
      });
    } catch (networkErr) {
      captureWebhookError(networkErr, {
        route: "/api/webhooks/mercadopago/ipn",
        paymentId,
        httpStatus: 502,
        extra: {
          failure_kind: "mercadopago_network",
        },
      });
      return Response.json({ error: "Falha temporaria de conexao com a API do Mercado Pago" }, { status: 502 });
    }

    if (paymentResponse.status >= 500) {
      captureWebhookError(
        new Error(`Mercado Pago IPN upstream error ${paymentResponse.status}`),
        {
          route: "/api/webhooks/mercadopago/ipn",
          paymentId,
          httpStatus: 502,
          extra: {
            upstream_status: paymentResponse.status,
          },
        }
      );
      return Response.json({ error: "Erro temporario na API do Mercado Pago", status: paymentResponse.status }, { status: 502 });
    }

    if (paymentResponse.status === 429) {
      captureWebhookError(
        new Error(`Mercado Pago IPN upstream rate limit ${paymentResponse.status}`),
        {
          route: "/api/webhooks/mercadopago/ipn",
          paymentId,
          httpStatus: 429,
          extra: {
            upstream_status: paymentResponse.status,
          },
        }
      );
      return Response.json({ error: "Rate limit excedido na API do Mercado Pago" }, { status: 429 });
    }

    if (paymentResponse.status === 404) {
      return Response.json({ received: true, ignored: true, error: "Pagamento inexistente no Mercado Pago" }, { status: 200 });
    }

    if (!paymentResponse.ok) {
      return Response.json({ received: true, ignored: true, error: `Mercado Pago retornou status ${paymentResponse.status}` }, { status: 200 });
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
      status: result.status,
    }, { status: 200 });
  } catch (error) {
    captureWebhookError(error, {
      route: "/api/webhooks/mercadopago/ipn",
      paymentId,
      httpStatus: 500,
    });
    return Response.json({ error: "Nao foi possivel processar o evento IPN" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleLegacyIpn(request, "");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return handleLegacyIpn(request, rawBody);
}
