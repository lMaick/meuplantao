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
import {
  LEGACY_IPN_DISABLED_CODE,
  LEGACY_IPN_DISABLED_PUBLIC_ERROR,
  getMercadoPagoAccessToken,
  getMercadoPagoApiUrl,
  isLegacyIpnEnabled,
} from "@/lib/mercadopago/config";
import { getValidityDays, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { extractPaymentInfo } from "@/lib/mercadopago/webhook";
import { captureError, captureRateLimitHit, captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const IPN_ROUTE = "/api/webhooks/mercadopago/ipn";


function isUserId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

/**
 * Handler legado para notificações IPN do Mercado Pago (sem cabeçalho x-signature).
 * A autenticidade é validada exclusivamente via consulta direta à API autenticada do Mercado Pago.
 *
 * MAI-138: kill-switch explícito em produção + rate limit/cooldown distribuído
 * (por IP e por identificador de pagamento) antes de qualquer consulta externa,
 * com 429/Retry-After, dedupe 200 (sem fetch repetido) e limites de
 * tamanho/formato de entrada.
 */
async function handleLegacyIpn(request: Request, rawBody: string) {
  // 1. Kill-switch explícito do IPN legado (MAI-138): em produção, desabilitado
  // por padrão — responde 410 SEM consultar o Mercado Pago.
  if (!isLegacyIpnEnabled()) {
    captureError(new Error(LEGACY_IPN_DISABLED_CODE), {
      route: IPN_ROUTE,
      httpStatus: 410,
      level: "warning",
    });
    return Response.json({ error: LEGACY_IPN_DISABLED_PUBLIC_ERROR, code: LEGACY_IPN_DISABLED_CODE }, { status: 410 });
  }

  const limiterOn = isBillingRateLimitEnabled();
  const clientIp = limiterOn ? getClientIp(request) : "unknown";
  const ipHash = limiterOn ? hashIpForLog(clientIp) : "unknown";
  const logStoreFallback = (storeName: string, errorMessage: string) => {
    captureRateLimitHit({
      route: IPN_ROUTE,
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

  // 2. Limite de tamanho de entrada (evita payloads abusivos).
  if (!getBillingBodySizeOk(rawBody)) {
    captureRateLimitHit({
      route: IPN_ROUTE,
      limitKind: "body_too_large",
      limit: 0,
      windowMs: 0,
      ipHash,
    });
    return Response.json({ error: "Notificacao excede o tamanho maximo permitido" }, { status: 413 });
  }

  // 3. Rate limit por IP (antes de qualquer consulta externa).
  if (limiterOn) {
    const ipDecision = await checkBillingLimit(
      billingLimitKey("billing", "ipn", "ip", ipHash),
      BILLING_LIMITS.ipnIp.limit,
      BILLING_LIMITS.ipnIp.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!ipDecision.allowed) {
      captureRateLimitHit({
        route: IPN_ROUTE,
        limitKind: "ip",
        limit: BILLING_LIMITS.ipnIp.limit,
        windowMs: BILLING_LIMITS.ipnIp.windowMs,
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

  // Ignora tópicos que não são de pagamento
  if (typeOrTopic && !typeOrTopic.toLowerCase().includes("payment") && typeOrTopic !== "payment.created" && typeOrTopic !== "payment.updated") {
    return Response.json({ received: true, ignored: true });
  }

  if (!paymentId) {
    return Response.json({ received: true, ignored: true, error: "IPN sem identificador de pagamento" }, { status: 200 });
  }

  // 4. Formato do identificador: entradas malformadas são ignoradas SEM fetch.
  if (!isValidBillingPaymentId(paymentId)) {
    return Response.json({ received: true, ignored: true, error: "Identificador de pagamento invalido" }, { status: 200 });
  }

  let cooldownStoreName: string | undefined;
  if (limiterOn) {
    // 5. Cooldown/dedupe por pagamento: rajadas retornam 200 SEM nova consulta.
    const cooldownKey = billingLimitKey("billing", "ipn", "cooldown", paymentId);
    const cooldown = await checkBillingCooldownAndMark(
      cooldownKey,
      BILLING_LIMITS.ipnPaymentCooldownMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    cooldownStoreName = cooldown.storeName;
    if (cooldown.deduped) {
      captureRateLimitHit({
        route: IPN_ROUTE,
        limitKind: "payment_cooldown",
        limit: 1,
        windowMs: BILLING_LIMITS.ipnPaymentCooldownMs,
        deduped: true,
        paymentId,
        storeName: cooldown.storeName,
        distributed: cooldown.distributed,
        storeFallback: cooldown.fallback,
        ipHash,
      });
      return Response.json({ received: true, deduped: true }, { status: 200 });
    }

    // 6. Teto por pagamento (proteção adicional além do cooldown).
    const paymentDecision = await checkBillingLimit(
      billingLimitKey("billing", "ipn", "payment", paymentId),
      BILLING_LIMITS.ipnPayment.limit,
      BILLING_LIMITS.ipnPayment.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!paymentDecision.allowed) {
      captureRateLimitHit({
        route: IPN_ROUTE,
        limitKind: "payment",
        limit: BILLING_LIMITS.ipnPayment.limit,
        windowMs: BILLING_LIMITS.ipnPayment.windowMs,
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
        billingLimitKey("billing", "ipn", "cooldown", paymentId),
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
        route: IPN_ROUTE,
        paymentId,
        httpStatus: 502,
        extra: {
          failure_kind: "mercadopago_network",
        },
      });
      return Response.json({ error: "Falha temporaria de conexao com a API do Mercado Pago" }, { status: 502 });
    }

    if (paymentResponse.status >= 500) {
      await releaseCooldown();
      captureWebhookError(
        new Error(`Mercado Pago IPN upstream error ${paymentResponse.status}`),
        {
          route: IPN_ROUTE,
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
      await releaseCooldown();
      captureWebhookError(
        new Error(`Mercado Pago IPN upstream rate limit ${paymentResponse.status}`),
        {
          route: IPN_ROUTE,
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
    await releaseCooldown();
    captureWebhookError(error, {
      route: IPN_ROUTE,
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
