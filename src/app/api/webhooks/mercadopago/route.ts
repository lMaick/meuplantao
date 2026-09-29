import {
  BILLING_LIMITS,
  billingLimitKey,
  buildBillingRateLimitedResponse,
  buildBillingStoresCollapsedResponse,
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
import { getValidityDays, hasProcessedMercadoPagoPayment, processMercadoPagoPayment } from "@/lib/mercadopago/payments";
import { WEBHOOK_NOT_CONFIGURED_CODE, WEBHOOK_NOT_CONFIGURED_PUBLIC_ERROR, extractPaymentInfo, isUserId, validateWebhookSignature } from "@/lib/mercadopago/webhook";
import { captureRateLimitHit, captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WEBHOOK_ROUTE = "/api/webhooks/mercadopago";

async function processPaymentWebhook(request: Request, rawBody: string) {
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
      // MAI-138 (auditoria externa, bloqueador 1): colapso => 503 retentável,
      // SEM nenhuma consulta externa ao Mercado Pago.
      if (ipDecision.collapsed) {
        captureRateLimitHit({
          route: WEBHOOK_ROUTE,
          limitKind: "stores_collapsed",
          limit: BILLING_LIMITS.webhookIp.limit,
          windowMs: BILLING_LIMITS.webhookIp.windowMs,
          retryAfterSeconds: ipDecision.retryAfterSeconds,
          storeName: ipDecision.storeName,
          distributed: ipDecision.distributed,
          storeFallback: ipDecision.fallback,
          ipHash,
        });
        return buildBillingStoresCollapsedResponse(ipDecision.retryAfterSeconds);
      }
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
  let inflightStoreName: string | undefined;
  const cooldownKey = billingLimitKey("billing", "webhook", "cooldown", paymentId);
  const inflightKey = billingLimitKey("billing", "webhook", "inflight", paymentId);
  // Libera os locks desta requisição (best-effort). Chamado em falhas
  // retentáveis e conclusões sem persistência; o sucesso com persistência
  // libera só o in-flight (a prova no banco + cooldown cobrem duplicatas).
  const releaseOwnLocks = () => {
    if (!limiterOn) return Promise.resolve();
    return Promise.all([
      releaseBillingCooldown(cooldownKey, cooldownStoreName).catch(() => undefined),
      releaseBillingCooldown(inflightKey, inflightStoreName).catch(() => undefined),
    ]).then(() => undefined);
  };
  const releaseInflight = () => {
    if (!limiterOn) return Promise.resolve();
    return releaseBillingCooldown(inflightKey, inflightStoreName).catch(() => undefined);
  };
  const collapsedResponse = (storeName: string, distributed: boolean, fallback: boolean) => {
    captureRateLimitHit({
      route: WEBHOOK_ROUTE,
      limitKind: "stores_collapsed",
      limit: 0,
      windowMs: 0,
      retryAfterSeconds: BILLING_LIMITS.storesCollapsedRetryAfterSeconds,
      paymentId,
      storeName,
      distributed,
      storeFallback: fallback,
      ipHash,
    });
    return buildBillingStoresCollapsedResponse(BILLING_LIMITS.storesCollapsedRetryAfterSeconds);
  };
  const inflightContentionResponse = (storeName: string, distributed: boolean, fallback: boolean) => {
    captureRateLimitHit({
      route: WEBHOOK_ROUTE,
      limitKind: "payment_inflight",
      limit: 1,
      windowMs: BILLING_LIMITS.webhookInflightMs,
      retryAfterSeconds: BILLING_LIMITS.inflightRetryAfterSeconds,
      paymentId,
      storeName,
      distributed,
      storeFallback: fallback,
      ipHash,
    });
    return buildBillingRateLimitedResponse(BILLING_LIMITS.inflightRetryAfterSeconds);
  };
  const readPersistedProof = async (): Promise<boolean> => {
    try {
      return await hasProcessedMercadoPagoPayment(createAdminClient(), paymentId);
    } catch {
      return false;
    }
  };

  if (limiterOn) {
    // MAI-138 (auditoria externa, bloqueador 2): duplicata pós-persistência
    // responde 200 SEM fetch — mesmo fora da janela do cooldown.
    if (await readPersistedProof()) {
      captureRateLimitHit({
        route: WEBHOOK_ROUTE,
        limitKind: "payment_deduped",
        limit: 1,
        windowMs: BILLING_LIMITS.webhookPaymentCooldownMs,
        deduped: true,
        paymentId,
        ipHash,
      });
      return Response.json({ received: true, deduped: true }, { status: 200 });
    }

    // Cooldown/dedupe por pagamento: SÓ responde 200 sem nova consulta quando
    // há prova de persistência (idempotência comprovada no banco). Sem prova —
    // concorrência em voo ou falha anterior — o lock in-flight decide abaixo
    // (nunca descarta retry legítimo).
    const cooldown = await checkBillingCooldownAndMark(
      cooldownKey,
      BILLING_LIMITS.webhookPaymentCooldownMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (cooldown.collapsed) return collapsedResponse(cooldown.storeName, cooldown.distributed, cooldown.fallback);
    cooldownStoreName = cooldown.storeName;
    if (cooldown.deduped) {
      if (await readPersistedProof()) {
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
      // Sem prova: pode ser concorrência em voo — tenta o lock in-flight.
      const inflight = await checkBillingCooldownAndMark(
        inflightKey,
        BILLING_LIMITS.webhookInflightMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      if (inflight.collapsed) {
        await releaseOwnLocks();
        return collapsedResponse(inflight.storeName, inflight.distributed, inflight.fallback);
      }
      inflightStoreName = inflight.storeName;
      if (inflight.deduped) {
        // Outra requisição está em voo: resposta retentável SEM novo fetch.
        return inflightContentionResponse(inflight.storeName, inflight.distributed, inflight.fallback);
      }
      // Lock adquirido sobre marca prematura: double-check — o dono anterior
      // pode ter persistido entre as leituras.
      if (await readPersistedProof()) {
        await releaseInflight();
        return Response.json({ received: true, deduped: true }, { status: 200 });
      }
      // Marca prematura (falha anterior) liberada; o in-flight agora protege.
      await releaseBillingCooldown(cooldownKey, cooldownStoreName).catch(() => undefined);
    } else {
      // Primeira marca: tenta o lock in-flight antes de qualquer fetch.
      const inflight = await checkBillingCooldownAndMark(
        inflightKey,
        BILLING_LIMITS.webhookInflightMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      if (inflight.collapsed) {
        await releaseOwnLocks();
        return collapsedResponse(inflight.storeName, inflight.distributed, inflight.fallback);
      }
      inflightStoreName = inflight.storeName;
      if (inflight.deduped) {
        await releaseBillingCooldown(cooldownKey, cooldownStoreName).catch(() => undefined);
        return inflightContentionResponse(inflight.storeName, inflight.distributed, inflight.fallback);
      }
    }

    const paymentDecision = await checkBillingLimit(
      billingLimitKey("billing", "webhook", "payment", paymentId),
      BILLING_LIMITS.webhookPayment.limit,
      BILLING_LIMITS.webhookPayment.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!paymentDecision.allowed) {
      if (paymentDecision.collapsed) {
        await releaseOwnLocks();
        return collapsedResponse(paymentDecision.storeName, paymentDecision.distributed, paymentDecision.fallback);
      }
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

  // Falhas retentáveis liberam cooldown + in-flight para preservar o retry
  // legítimo do provedor (o próximo retry volta a consultar a API).
  const releaseCooldown = () => releaseOwnLocks();

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
      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, error: "Pagamento inexistente no Mercado Pago" },
        { status: 200 },
      );
    }

    if (!paymentResponse.ok) {
      await releaseInflight();
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
      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, status: payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    const [externalUserId, externalMonths] = (payment.external_reference || "").split("#");
    const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

    if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, error: "Identificadores de usuario divergentes no pagamento" },
        { status: 200 },
      );
    }

    const userId = externalUserId || metadataUserId;
    if (!isUserId(userId)) {
      await releaseInflight();
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

    // Sucesso com persistência: libera o in-flight (duplicatas futuras caem
    // na prova de persistência => 200 deduped sem fetch). O cooldown é
    // mantido como proteção adicional dentro da janela.
    await releaseInflight();

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
