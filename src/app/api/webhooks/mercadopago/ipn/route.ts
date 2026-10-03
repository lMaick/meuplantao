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
import {
  LEGACY_IPN_DISABLED_CODE,
  LEGACY_IPN_DISABLED_PUBLIC_ERROR,
  isLegacyIpnEnabled,
} from "@/lib/mercadopago/config";
import {
  MercadoPagoTimeoutError,
  SupabaseRpcTimeoutError,
  fetchMercadoPago,
  getTimeoutForOperation,
  isTransientMercadoPagoStatus,
  sanitizedMercadoPagoLogContext,
} from "@/lib/mercadopago/http";
import {
  completeSubscriptionCheckout,
  getValidityDays,
  isQuoteConsumedError,
  processMercadoPagoPayment,
  quarantinePayment,
  validatePaymentBeforeGrantingPro,
  type MercadoPagoPaymentPayload,
} from "@/lib/mercadopago/payments";
import { isDisputeStatus, isReversalStatus, reconcileMercadoPagoReversal } from "@/lib/mercadopago/reversals";
import { extractPaymentInfo, isUserId } from "@/lib/mercadopago/webhook";
import { captureError, captureRateLimitHit, captureWebhookError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const IPN_ROUTE = "/api/webhooks/mercadopago/ipn";
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
      // MAI-138 (auditoria externa, bloqueador 1): colapso => 503 retentável,
      // SEM nenhuma consulta externa ao Mercado Pago.
      if (ipDecision.collapsed) {
        captureRateLimitHit({
          route: IPN_ROUTE,
          limitKind: "stores_collapsed",
          limit: BILLING_LIMITS.ipnIp.limit,
          windowMs: BILLING_LIMITS.ipnIp.windowMs,
          retryAfterSeconds: ipDecision.retryAfterSeconds,
          storeName: ipDecision.storeName,
          distributed: ipDecision.distributed,
          storeFallback: ipDecision.fallback,
          ipHash,
        });
        return buildBillingStoresCollapsedResponse(ipDecision.retryAfterSeconds);
      }
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
  let inflightStoreName: string | undefined;
  const cooldownKey = billingLimitKey("billing", "ipn", "cooldown", paymentId);
  const inflightKey = billingLimitKey("billing", "ipn", "inflight", paymentId);
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
      route: IPN_ROUTE,
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
      route: IPN_ROUTE,
      limitKind: "payment_inflight",
      limit: 1,
      windowMs: BILLING_LIMITS.ipnInflightMs,
      retryAfterSeconds: BILLING_LIMITS.inflightRetryAfterSeconds,
      paymentId,
      storeName,
      distributed,
      storeFallback: fallback,
      ipHash,
    });
    return buildBillingRateLimitedResponse(BILLING_LIMITS.inflightRetryAfterSeconds);
  };
  if (limiterOn) {
    // MAI-149 (auditoria 2026-10-02, finding bloqueador): o cooldown curto NÃO
    // pode retornar HTTP 200 `deduped:true` sem consultar o Mercado Pago, mesmo
    // quando o `payment_id` já possui prova persistida. O mesmo payment_id pode
    // transitar `approved -> refunded/charged_back` DENTRO da janela de 30s; como
    // 200 não garante retry do provedor, a reversão seria perdida e o Pro ficaria
    // ativo indevidamente. Correção: SEMPRE consultar o estado atual no provedor
    // (fonte da verdade), mesmo dentro do cooldown. `payment_id` já visto impede
    // NOVA concessão via RPC idempotente (`already_processed`, sem nova vigência),
    // nunca impede observação de mudança de status; `refunded`/`charged_back`
    // chegam a `reconcileMercadoPagoReversal()`. Rajadas concorrentes seguem
    // protegidas pelo lock in-flight (só o dono faz fetch; demais recebem 429
    // retentável com Retry-After). Nenhum 200 terminal sem fetch neste fluxo.

    // 5. Cooldown por pagamento: sinal de rajada, NUNCA dedupe terminal sem
    // fetch. Contenção concorrente => 429 retentável; duplicata sequencial com
    // lock livre => consulta o estado atual (idempotência via RPC/ledger).
    const cooldown = await checkBillingCooldownAndMark(
      cooldownKey,
      BILLING_LIMITS.ipnPaymentCooldownMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (cooldown.collapsed) return collapsedResponse(cooldown.storeName, cooldown.distributed, cooldown.fallback);
    cooldownStoreName = cooldown.storeName;
    if (cooldown.deduped) {
      // Dentro da janela curta: NÃO dedupe terminal. Tenta o lock in-flight —
      // contenção concorrente => 429 retentável (o MP retenta após a janela);
      // lock livre (duplicata sequencial) => segue para fetch do estado atual.
      captureRateLimitHit({
        route: IPN_ROUTE,
        limitKind: "payment_cooldown",
        limit: 1,
        windowMs: BILLING_LIMITS.ipnPaymentCooldownMs,
        deduped: false,
        paymentId,
        storeName: cooldown.storeName,
        distributed: cooldown.distributed,
        storeFallback: cooldown.fallback,
        ipHash,
      });
      const inflight = await checkBillingCooldownAndMark(
        inflightKey,
        BILLING_LIMITS.ipnInflightMs,
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
      // Lock adquirido dentro do cooldown: segue para consulta ao MP abaixo.
      // Idempotência via RPC/ledger; cooldown mantido para métricas.
    } else {
      // Primeira marca: tenta o lock in-flight antes de qualquer fetch.
      const inflight = await checkBillingCooldownAndMark(
        inflightKey,
        BILLING_LIMITS.ipnInflightMs,
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

    // 6. Teto por pagamento (proteção adicional além do cooldown).
    const paymentDecision = await checkBillingLimit(
      billingLimitKey("billing", "ipn", "payment", paymentId),
      BILLING_LIMITS.ipnPayment.limit,
      BILLING_LIMITS.ipnPayment.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!paymentDecision.allowed) {
      if (paymentDecision.collapsed) {
        await releaseOwnLocks();
        return collapsedResponse(paymentDecision.storeName, paymentDecision.distributed, paymentDecision.fallback);
      }
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

  // Falhas retentáveis liberam cooldown + in-flight para preservar o retry
  // legítimo do provedor (o próximo retry volta a consultar a API).
  const releaseCooldown = () => releaseOwnLocks();

  try {
    // MAI-144: GET idempotente com deadline explícito. Timeout/queda => 504/502
    // retentável (o provedor retenta) SEM conceder Pro e SEM tocar o ledger.
    // Erro definitivo (400/401/403/404/422) => 200 ignored, sem retry.
    const ipnTimeoutMs = getTimeoutForOperation("payments.get");
    let paymentResponse: Response;
    try {
      paymentResponse = await fetchMercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, {
        operation: "payments.get",
        timeoutMs: ipnTimeoutMs,
        method: "GET",
      });
    } catch (networkErr) {
      await releaseCooldown();
      const isTimeout = networkErr instanceof MercadoPagoTimeoutError;
      captureWebhookError(networkErr, {
        route: IPN_ROUTE,
        paymentId,
        httpStatus: isTimeout ? 504 : 502,
        extra: {
          retryable: true,
          ...sanitizedMercadoPagoLogContext({
            operation: "payments.get",
            timeoutMs: ipnTimeoutMs,
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
      await releaseInflight();
      return Response.json({ received: true, ignored: true, error: "Pagamento inexistente no Mercado Pago" }, { status: 200 });
    }

    // MAI-144 (auditoria): transitório restante (408/425) => 502 retentável,
    // com locks liberados para o retry legítimo do provedor — nunca 200.
    if (!paymentResponse.ok && isTransientMercadoPagoStatus(paymentResponse.status)) {
      await releaseCooldown();
      captureWebhookError(
        new Error(`Mercado Pago IPN upstream transient ${paymentResponse.status}`),
        {
          route: IPN_ROUTE,
          paymentId,
          httpStatus: 502,
          extra: {
            retryable: true,
            upstream_status: paymentResponse.status,
          },
        }
      );
      return Response.json({ error: "Erro temporario na API do Mercado Pago", status: paymentResponse.status }, { status: 502 });
    }

    if (!paymentResponse.ok) {
      await releaseInflight();
      return Response.json({ received: true, ignored: true, error: `Mercado Pago retornou status ${paymentResponse.status}` }, { status: 200 });
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPaymentPayload;
    const admin = createAdminClient();

    const [externalUserId, externalMonths] = (payment.external_reference || "").split("#");
    const metadataUserId = (payment.metadata?.user_id || payment.metadata?.userId || "").trim();

    if (externalUserId && metadataUserId && externalUserId !== metadataUserId) {
      await releaseInflight();
      return Response.json({ received: true, ignored: true, error: "Identificadores de usuario divergentes no pagamento" }, { status: 200 });
    }

    const userId = externalUserId || metadataUserId;

    // 4a. Reversao definitiva (provedor como fonte da verdade): reconcilia sem apagar ledger (MAI-136).
    if (isReversalStatus(payment.status)) {
      if (!isUserId(userId)) {
        await releaseInflight();
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
        await releaseInflight();
        return Response.json({ received: true, ignored: true, error: "Pagamento nao pertence a esta conta" }, { status: 200 });
      }
      await releaseInflight();
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
      await releaseInflight();
      return Response.json({ received: true, ignored: true, needs_review: true, status: payment.status ?? "unknown" }, { status: 200 });
    }

    // 4c. Pagamento recebido, mas ainda não aprovado (status !== "approved")
    if (payment.status !== "approved") {
      await releaseInflight();
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

    // Claim atômico da cotação na mesma transação da vigência (MAI-147);
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
    return Response.json({
      received: true,
      processed: true,
      already_processed: result.already_processed,
      current_period_end: result.current_period_end,
      status: result.status,
    }, { status: 200 });
  } catch (error) {
    await releaseCooldown();
    // MAI-144 (auditoria): deadline da RPC do Supabase estourado é transitório
    // — 502 retentável com locks liberados para o retry do provedor; o retry é
    // seguro pela idempotência da RPC (claim único por payment_id).
    if (error instanceof SupabaseRpcTimeoutError) {
      captureWebhookError(error, {
        route: IPN_ROUTE,
        paymentId,
        httpStatus: 502,
        extra: {
          retryable: true,
          failure_kind: "supabase_rpc_timeout",
          rpc_name: error.rpcName,
        },
      });
      return Response.json(
        { error: "Tempo esgotado no processamento. Tente novamente.", retryable: true },
        { status: 502 },
      );
    }
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
