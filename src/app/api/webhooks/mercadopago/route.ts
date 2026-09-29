import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, getWebhookSetupState } from "@/lib/mercadopago/config";
import {
  completeSubscriptionCheckout,
  getValidityDays,
  processMercadoPagoPayment,
  quarantinePayment,
  validatePaymentBeforeGrantingPro,
  type MercadoPagoPaymentPayload,
} from "@/lib/mercadopago/payments";
import { isDisputeStatus, isReversalStatus, reconcileMercadoPagoReversal } from "@/lib/mercadopago/reversals";
import { WEBHOOK_NOT_CONFIGURED_CODE, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR, extractPaymentInfo, isUserId, validateWebhookSignature } from "@/lib/mercadopago/webhook";
import { captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export { extractPaymentInfo, validateWebhookSignature };

export async function processPaymentWebhook(request: Request, rawBody: string) {
  if (getWebhookSetupState().failClosed) {
    return Response.json({ error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR }, { status: 503 });
  }

  const { typeOrTopic, paymentId } = extractPaymentInfo(request, rawBody);

  // Validação de assinatura criptográfica moderna
  const sigValidation = validateWebhookSignature(request, paymentId);
  if (!sigValidation.valid) {
    if (sigValidation.code === WEBHOOK_NOT_CONFIGURED_CODE) {
      return Response.json({ error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR }, { status: 503 });
    }
    return Response.json({ error: sigValidation.error || "Assinatura Mercado Pago invalida" }, { status: 401 });
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
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
      });
    } catch (networkErr) {
      captureWebhookError(networkErr, {
        paymentId,
        httpStatus: 502,
        extra: {
          failure_kind: "mercadopago_network",
        },
      });
      return Response.json(
        { error: "Falha temporaria de conexao com a API do Mercado Pago" },
        { status: 502 },
      );
    }

    // 1. Falhas temporárias da API do Mercado Pago (5xx)
    if (paymentResponse.status >= 500) {
      captureWebhookError(
        new Error(`Mercado Pago upstream error ${paymentResponse.status}`),
        {
          paymentId,
          httpStatus: 502,
          extra: {
            upstream_status: paymentResponse.status,
          },
        }
      );
      return Response.json(
        { error: "Falha temporaria na API do Mercado Pago", status: paymentResponse.status },
        { status: 502 },
      );
    }

    // 2. Rate Limit (429)
    if (paymentResponse.status === 429) {
      captureWebhookError(
        new Error(`Mercado Pago upstream rate limit ${paymentResponse.status}`),
        {
          paymentId,
          httpStatus: 429,
          extra: {
            upstream_status: paymentResponse.status,
          },
        }
      );
      return Response.json(
        { error: "Rate limit excedido na API do Mercado Pago" },
        { status: 429 },
      );
    }

    // 3. Pagamento inexistente no Mercado Pago (404 - Permanente)
    if (paymentResponse.status === 404) {
      return Response.json(
        { received: true, ignored: true, error: "Pagamento inexistente no Mercado Pago" },
        { status: 200 },
      );
    }

    if (!paymentResponse.ok) {
      return Response.json(
        { received: true, ignored: true, error: `Mercado Pago retornou status ${paymentResponse.status}` },
        { status: 200 },
      );
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPaymentPayload;
    const admin = createAdminClient();

    // 4a. Reversao definitiva (provedor como fonte da verdade — MAI-136).
    // Tem precedencia sobre a validacao de concessao: o estado atual do provedor
    // decide, nunca o evento isolado (cobre aprovado→reembolsado/chargeback,
    // duplicacao, fora de ordem e notificacao approved antiga).
    if (isReversalStatus(payment.status)) {
      const [externalUserId, externalMonths] = (payment.external_reference || "").split("#");
      const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

      if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
        return Response.json(
          { received: true, ignored: true, error: "Identificadores de usuario divergentes no pagamento" },
          { status: 200 },
        );
      }

      const reversalUserId = externalUserId || metadataUserId;
      if (!isUserId(reversalUserId)) {
        return Response.json(
          { received: true, ignored: true, error: "Pagamento sem usuario valido associado" },
          { status: 200 },
        );
      }

      const reversalMonths = Number(payment.metadata?.months || externalMonths || 1);
      const result = await reconcileMercadoPagoReversal(admin, {
        paymentId,
        userId: reversalUserId,
        reversalStatus: payment.status ?? "refunded",
        months: reversalMonths,
        validityDays: getValidityDays(reversalMonths),
        amount: payment.transaction_amount,
      });
      if (result.ownership_mismatch) {
        return Response.json(
          { received: true, ignored: true, error: "Pagamento nao pertence a esta conta" },
          { status: 200 },
        );
      }
      return Response.json(
        {
          received: true,
          reversed: true,
          already_reversed: result.already_reversed,
          current_period_end: result.current_period_end,
          status: result.status,
        },
        { status: 200 },
      );
    }

    // 4b. Disputa em aberto: sinaliza revisao humana, sem revogar automaticamente (MAI-136).
    if (isDisputeStatus(payment.status)) {
      const disputeUserId = (payment.external_reference || "").split("#")[0]
        || (payment.metadata?.user_id || payment.metadata?.userId || "").trim()
        || undefined;
      captureWebhookError(new Error("Mercado Pago payment under dispute review"), {
        route: "/api/webhooks/mercadopago",
        paymentId,
        userId: disputeUserId,
        extra: { provider_status: payment.status, needs_review: true },
      });
      return Response.json(
        { received: true, ignored: true, needs_review: true, status: payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    // 4c. Validação rigorosa de segurança, plano, preço, moeda e integridade antes de conceder Pro (MAI-137)
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
        captureWebhookError(new Error(`Pagamento Mercado Pago em quarentena: ${valResult.reason}`), {
          paymentId,
          userId: valResult.userId || undefined,
          extra: {
            quarantine_reason: valResult.reason,
            details: valResult.details,
          },
        });
        return Response.json(
          { received: true, processed: false, quarantined: true, reason: valResult.reason },
          { status: 200 },
        );
      }

      // Pagamento não aprovado (status !== "approved")
      return Response.json(
        { received: true, ignored: true, status: valResult.status ?? payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    // 5. Pagamento válido: executa concessão atômica de vigência via RPC
    const result = await processMercadoPagoPayment(admin, {
      paymentId,
      userId: valResult.userId,
      months: valResult.months,
      validityDays: valResult.validityDays,
      amount: valResult.amount,
      status: payment.status ?? "approved",
    });

    if (valResult.checkoutId) {
      await completeSubscriptionCheckout(admin, valResult.checkoutId);
    }

    return Response.json(
      {
        received: true,
        processed: true,
        already_processed: result.already_processed,
        current_period_end: result.current_period_end,
        status: result.status,
      },
      { status: 200 },
    );
  } catch (error) {
    captureWebhookError(error, {
      route: "/api/webhooks/mercadopago",
      paymentId,
      httpStatus: 500,
    });
    return Response.json({ error: "Nao foi possivel processar o evento Mercado Pago" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return processPaymentWebhook(request, "");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return processPaymentWebhook(request, rawBody);
}
