import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import {
  completeSubscriptionCheckout,
  getValidityDays,
  processMercadoPagoPayment,
  quarantinePayment,
  validatePaymentBeforeGrantingPro,
  type MercadoPagoPaymentPayload,
} from "@/lib/mercadopago/payments";
import { isDisputeStatus, isReversalStatus, reconcileMercadoPagoReversal } from "@/lib/mercadopago/reversals";
import { extractPaymentInfo, isUserId } from "@/lib/mercadopago/webhook";
import { captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

    const payment = (await paymentResponse.json()) as MercadoPagoPaymentPayload;
    const admin = createAdminClient();

    const [externalUserId, externalMonths] = (payment.external_reference || "").split("#");
    const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

    if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
      return Response.json({ received: true, ignored: true, error: "Identificadores de usuario divergentes no pagamento" }, { status: 200 });
    }

    const userId = externalUserId || metadataUserId;

    // 4a. Reversao definitiva (provedor como fonte da verdade): reconcilia sem apagar ledger (MAI-136).
    if (isReversalStatus(payment.status)) {
      if (!isUserId(userId)) {
        return Response.json({ received: true, ignored: true, error: "Pagamento sem usuario valido associado" }, { status: 200 });
      }
      const months = Number(payment.metadata?.months || externalMonths || 1);
      const validityDays = getValidityDays(months);
      const result = await reconcileMercadoPagoReversal(admin, {
        paymentId,
        userId,
        reversalStatus: payment.status ?? "refunded",
        months,
        validityDays,
        amount: payment.transaction_amount ?? undefined,
      });
      if (result.ownership_mismatch) {
        return Response.json({ received: true, ignored: true, error: "Pagamento nao pertence a esta conta" }, { status: 200 });
      }
      return Response.json({
        received: true,
        reversed: true,
        already_reversed: result.already_reversed,
        current_period_end: result.current_period_end,
        status: result.status,
      }, { status: 200 });
    }

    // 4b. Disputa em aberto: sinaliza revisao humana, sem revogar automaticamente (MAI-136).
    if (isDisputeStatus(payment.status)) {
      captureWebhookError(new Error("Mercado Pago IPN payment under dispute review"), {
        route: "/api/webhooks/mercadopago/ipn",
        paymentId,
        userId: userId || undefined,
        extra: { provider_status: payment.status, needs_review: true },
      });
      return Response.json({ received: true, ignored: true, needs_review: true, status: payment.status ?? "unknown" }, { status: 200 });
    }

    // 4c. Pagamento recebido, mas ainda não aprovado (status !== "approved")
    if (payment.status !== "approved") {
      return Response.json({ received: true, ignored: true, status: payment.status ?? "unknown" }, { status: 200 });
    }

    // 4d. Validação rigorosa de integridade e financeiro (MAI-137)
    const valResult = await validatePaymentBeforeGrantingPro(admin, payment);

    if (!valResult.valid) {
      if (valResult.quarantine) {
        await quarantinePayment(admin, {
          paymentId,
          userId: valResult.userId,
          reason: valResult.reason,
          amount: payment.transaction_amount,
          currency: payment.currency_id,
          months: payment.metadata?.months,
          rawPayload: payment as Record<string, unknown>,
        });
        captureWebhookError(new Error(`IPN Mercado Pago em quarentena: ${valResult.reason}`), {
          route: "/api/webhooks/mercadopago/ipn",
          paymentId,
          userId: valResult.userId || undefined,
          extra: { quarantine_reason: valResult.reason, details: valResult.details },
        });
        return Response.json(
          { received: true, processed: false, quarantined: true, reason: valResult.reason },
          { status: 200 },
        );
      }

      return Response.json(
        { received: true, ignored: true, status: valResult.status ?? payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    const result = await processMercadoPagoPayment(admin, {
      paymentId,
      userId: valResult.userId,
      months: valResult.months,
      validityDays: valResult.validityDays,
      amount: valResult.amount,
      status: payment.status ?? "approved",
    });

    if (valResult.checkoutId) {
      await completeSubscriptionCheckout(admin, valResult.checkoutId, paymentId);
    }

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
