import {
  BILLING_LIMITS,
  billingLimitKey,
  buildBillingRateLimitedResponse,
  checkBillingCooldownAndMark,
  checkBillingLimit,
  getBillingBodySizeOk,
  getClientIp,
  hashIpForLog,
  isBillingRateLimitEnabled,
  isValidBillingPaymentId,
  releaseBillingCooldown,
} from "@/lib/billing/rate-limit";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, getWebhookSetupState } from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { WEBHOOK_NOT_CONFIGURED_CODE, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR, extractPaymentInfo, isUserId, validateWebhookSignature } from "@/lib/mercadopago/webhook";
import { captureRateLimitHit, captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WEBHOOK_ROUTE = "/api/webhooks/mercadopago";

export { extractPaymentInfo, validateWebhookSignature };

export async function processPaymentWebhook(request: Request, rawBody: string) {
  if (getWebhookSetupState().failClosed) {
    return Response.json({ error: WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR }, { status: 503 });
  }

  // MAI-138: limitador distribuído (ligado em produção / opt-in em dev/teste).
  const limiterOn = isBillingRateLimitEnabled();
  const clientIp = limiterOn ? getClientIp(request) : "unknown";
  const ipHash = limiterOn ? hashIpForLog(clientIp) : "unknown";
  const logStoreFallback = (storeName: string, errorMessage: string) => {
    captureRateLimitHit({
      route: WEBHOOK_ROUTE,
      limitKind: "store_fallback",
      limit: 0,
      windowMs: 0,
      storeName,
      distributed: false,
      storeFallback: true,
      ipHash,
      storeError: errorMessage,
    });
  };

  if (!getBillingBodySizeOk(rawBody)) {
    captureRateLimitHit({
      route: WEBHOOK_ROUTE,
      limitKind: "body_too_large",
      limit: 0,
      windowMs: 0,
      ipHash,
    });
    return Response.json({ error: "Notificacao excede o tamanho maximo permitido" }, { status: 413 });
  }

  if (limiterOn) {
    const ipDecision = await checkBillingLimit(
      billingLimitKey("billing", "webhook", "ip", ipHash),
      BILLING_LIMITS.webhookIp.limit,
      BILLING_LIMITS.webhookIp.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!ipDecision.allowed) {
      captureRateLimitHit({
        route: WEBHOOK_ROUTE,
        limitKind: "ip",
        limit: BILLING_LIMITS.webhookIp.limit,
        windowMs: BILLING_LIMITS.webhookIp.windowMs,
        retryAfterSeconds: ipDecision.retryAfterSeconds,
        storeName: ipDecision.storeName,
        distributed: ipDecision.distributed,
        storeFallback: ipDecision.fallback,
        ipHash,
      });
      return buildBillingRateLimitedResponse(ipDecision.retryAfterSeconds);
    }
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

  // MAI-138: formato inválido nunca gera consulta externa.
  if (!isValidBillingPaymentId(paymentId)) {
    return Response.json({ received: true, ignored: true, error: "Identificador de pagamento invalido" }, { status: 200 });
  }

  let cooldownStoreName: string | undefined;
  if (limiterOn) {
    // Cooldown/dedupe por pagamento: rajadas retornam 200 SEM nova consulta.
    const cooldownKey = billingLimitKey("billing", "webhook", "cooldown", paymentId);
    const cooldown = await checkBillingCooldownAndMark(
      cooldownKey,
      BILLING_LIMITS.webhookPaymentCooldownMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    cooldownStoreName = cooldown.storeName;
    if (cooldown.deduped) {
      captureRateLimitHit({
        route: WEBHOOK_ROUTE,
        limitKind: "payment_cooldown",
        limit: 1,
        windowMs: BILLING_LIMITS.webhookPaymentCooldownMs,
        deduped: true,
        paymentId,
        storeName: cooldown.storeName,
        distributed: cooldown.distributed,
        storeFallback: cooldown.fallback,
        ipHash,
      });
      return Response.json({ received: true, deduped: true }, { status: 200 });
    }

    const paymentDecision = await checkBillingLimit(
      billingLimitKey("billing", "webhook", "payment", paymentId),
      BILLING_LIMITS.webhookPayment.limit,
      BILLING_LIMITS.webhookPayment.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!paymentDecision.allowed) {
      captureRateLimitHit({
        route: WEBHOOK_ROUTE,
        limitKind: "payment",
        limit: BILLING_LIMITS.webhookPayment.limit,
        windowMs: BILLING_LIMITS.webhookPayment.windowMs,
        retryAfterSeconds: paymentDecision.retryAfterSeconds,
        paymentId,
        storeName: paymentDecision.storeName,
        distributed: paymentDecision.distributed,
        storeFallback: paymentDecision.fallback,
        ipHash,
      });
      return buildBillingRateLimitedResponse(paymentDecision.retryAfterSeconds);
    }
  }

  // Falhas retentáveis liberam o cooldown para preservar o retry do provedor.
  const releaseCooldown = () => {
    if (limiterOn) {
      return releaseBillingCooldown(
        billingLimitKey("billing", "webhook", "cooldown", paymentId),
        cooldownStoreName,
      ).catch(() => undefined);
    }
    return Promise.resolve();
  };

  try {
    let paymentResponse: Response;
    try {
      paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
      });
    } catch (networkErr) {
      await releaseCooldown();
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
      await releaseCooldown();
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
      await releaseCooldown();
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

    const payment = (await paymentResponse.json()) as {
      status?: string;
      external_reference?: string;
      date_created?: string;
      date_approved?: string;
      transaction_amount?: number;
      metadata?: { user_id?: string; userId?: string; months?: number };
    };

    // 4. Pagamento recebido, mas ainda não aprovado (status !== "approved")
    if (payment.status !== "approved") {
      return Response.json(
        { received: true, ignored: true, status: payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    const [externalUserId, externalMonths] = (payment.external_reference || "").split("#");
    const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

    if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
      return Response.json(
        { received: true, ignored: true, error: "Identificadores de usuario divergentes no pagamento" },
        { status: 200 },
      );
    }

    const userId = externalUserId || metadataUserId;
    if (!isUserId(userId)) {
      return Response.json(
        { received: true, ignored: true, error: "Pagamento sem usuario valido associado" },
        { status: 200 },
      );
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
    await releaseCooldown();
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
