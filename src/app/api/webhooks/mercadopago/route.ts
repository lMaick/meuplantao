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
import { getWebhookSetupState } from "@/lib/mercadopago/config";
import {
  MercadoPagoTimeoutError,
  fetchMercadoPago,
  getTimeoutForOperation,
  isTransientMercadoPagoStatus,
  sanitizedMercadoPagoLogContext,
} from "@/lib/mercadopago/http";
import {
  completeSubscriptionCheckout,
  getValidityDays,
  hasProcessedMercadoPagoPayment,
  isQuoteConsumedError,
  processMercadoPagoPayment,
  quarantinePayment,
  validatePaymentBeforeGrantingPro,
  type MercadoPagoPaymentPayload,
} from "@/lib/mercadopago/payments";
import { isDisputeStatus, isReversalStatus, reconcileMercadoPagoReversal } from "@/lib/mercadopago/reversals";
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
    return Response.json({ received: true, ignored: true, error: "Identificador de pagamento ausente" }, { status: 200 });
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
    // MAI-144: GET idempotente com deadline explícito. Timeout/queda => 504/502
    // retentável (o provedor retenta) SEM conceder Pro e SEM tocar o ledger.
    // Erro definitivo (400/401/403/404/422) => 200 ignored, sem retry.
    const webhookTimeoutMs = getTimeoutForOperation("payments.get");
    let paymentResponse: Response;
    try {
      paymentResponse = await fetchMercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, {
        operation: "payments.get",
        timeoutMs: webhookTimeoutMs,
        method: "GET",
      });
    } catch (networkErr) {
      await releaseCooldown();
      const isTimeout = networkErr instanceof MercadoPagoTimeoutError;
      captureWebhookError(networkErr, {
        paymentId,
        httpStatus: isTimeout ? 504 : 502,
        extra: {
          retryable: true,
          ...sanitizedMercadoPagoLogContext({
            operation: "payments.get",
            timeoutMs: webhookTimeoutMs,
            paymentId,
            failureKind: isTimeout ? "mercadopago_timeout" : "mercadopago_network",
          }),
        },
      });
      return Response.json(
        { error: isTimeout ? "Tempo esgotado na consulta a API do Mercado Pago" : "Falha temporaria de conexao com a API do Mercado Pago" },
        { status: isTimeout ? 504 : 502 },
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

    // MAI-144 (auditoria): transitório restante (408/425) => 502 retentável,
    // com locks liberados para o retry legítimo do provedor — nunca 200.
    if (!paymentResponse.ok && isTransientMercadoPagoStatus(paymentResponse.status)) {
      await releaseCooldown();
      captureWebhookError(
        new Error(`Mercado Pago upstream transient ${paymentResponse.status}`),
        {
          paymentId,
          httpStatus: 502,
          extra: {
            retryable: true,
            upstream_status: paymentResponse.status,
          },
        }
      );
      return Response.json(
        { error: "Falha temporaria na API do Mercado Pago", status: paymentResponse.status },
        { status: 502 },
      );
    }

    // MAI-144: neste ponto restam apenas erros definitivos (400/401/403/422) —
    // 200 ignored, sem retry storm e sem tocar o ledger.
    if (!paymentResponse.ok) {
      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, error: `Mercado Pago retornou status ${paymentResponse.status}` },
        { status: 200 },
      );
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPaymentPayload;
    const admin = createAdminClient();

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

    // 4a. Reversao definitiva (provedor como fonte da verdade): reconcilia sem apagar ledger (MAI-136).
    if (isReversalStatus(payment.status)) {
      if (!isUserId(userId)) {
        await releaseInflight();
        return Response.json(
          { received: true, ignored: true, error: "Pagamento sem usuario valido associado" },
          { status: 200 },
        );
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
        await releaseInflight();
        return Response.json(
          { received: true, ignored: true, error: "Pagamento nao pertence a esta conta" },
          { status: 200 },
        );
      }
      await releaseInflight();
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
      captureWebhookError(new Error("Mercado Pago payment under dispute review"), {
        route: "/api/webhooks/mercadopago",
        paymentId,
        userId: userId || undefined,
        extra: { provider_status: payment.status, needs_review: true },
      });
      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, needs_review: true, status: payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    // 4c. Pagamento recebido, mas ainda não aprovado (status !== "approved")
    if (payment.status !== "approved") {
      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, status: payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    // 4d. Validação rigorosa de plano, preço, moeda e cotação antes de conceder Pro (MAI-137)
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
        await releaseInflight();
        return Response.json(
          { received: true, processed: false, quarantined: true, reason: valResult.reason },
          { status: 200 },
        );
      }

      await releaseInflight();
      return Response.json(
        { received: true, ignored: true, status: valResult.status ?? payment.status ?? "unknown" },
        { status: 200 },
      );
    }

    // 5. Pagamento válido: executa concessão atômica de vigência via RPC.
    // O claim da cotação ocorre na mesma transação (p_checkout_id); o
    // completeSubscriptionCheckout abaixo é apenas fallback best-effort CAS.
    let result;
    try {
      result = await processMercadoPagoPayment(admin, {
        paymentId,
        userId: valResult.userId,
        months: valResult.months,
        validityDays: valResult.validityDays,
        amount: valResult.amount,
        status: payment.status ?? "approved",
        checkoutId: valResult.checkoutId,
      });
    } catch (rpcError) {
      // Disputa concorrente pela mesma cotação: outro payment ID venceu o claim
      // atômico (23505). Determinístico — quarentena em vez de retry infinito.
      if (isQuoteConsumedError(rpcError)) {
        await quarantinePayment(admin, {
          paymentId,
          userId: valResult.userId,
          reason: "checkout_already_completed",
          amount: payment.transaction_amount,
          currency: payment.currency_id,
          months: payment.metadata?.months,
          checkoutId: valResult.checkoutId,
          rawPayload: payment as Record<string, unknown>,
        });
        await releaseInflight();
        return Response.json(
          { received: true, processed: false, quarantined: true, reason: "checkout_already_completed" },
          { status: 200 },
        );
      }
      throw rpcError;
    }

    if (valResult.checkoutId) {
      await completeSubscriptionCheckout(admin, valResult.checkoutId, paymentId);
    }

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
