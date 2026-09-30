import { NextResponse, type NextRequest } from "next/server";
import {
  BILLING_LIMITS,
  billingLimitKey,
  buildBillingRateLimitedResponse,
  buildBillingStoresCollapsedResponse,
  checkBillingCooldownAndMark,
  checkBillingLimit,
  getClientIp,
  hashIpForLog,
  isBillingRateLimitEnabled,
  releaseBillingCooldown,
} from "@/lib/billing/rate-limit";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl, paymentBelongsToUser } from "@/lib/mercadopago/config";
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
import { captureError, captureRateLimitHit } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VERIFY_ROUTE = "/api/mercadopago/verify";

function getPaymentId(request: NextRequest): string | null {
  const paymentId = request.nextUrl.searchParams.get("payment_id")?.trim();
  const collectionId = request.nextUrl.searchParams.get("collection_id")?.trim();
  const identifier = paymentId || collectionId;
  return identifier && identifier.length <= 200 ? identifier : null;
}

export async function GET(request: NextRequest) {
  const sessionResponse = NextResponse.json({ error: "Nao foi possivel verificar o pagamento" }, { status: 500 });
  const requestedPaymentId = getPaymentId(request);
  let currentUserId: string | undefined;

  // MAI-138: limitador distribuído (ligado em produção / opt-in em dev/teste).
  const limiterOn = isBillingRateLimitEnabled();
  const clientIp = limiterOn ? getClientIp(request) : "unknown";
  const ipHash = limiterOn ? hashIpForLog(clientIp) : "unknown";
  const logStoreFallback = (storeName: string, errorMessage: string) => {
    captureRateLimitHit({
      route: VERIFY_ROUTE,
      limitKind: "store_fallback",
      limit: 0,
      windowMs: 0,
      storeName,
      distributed: false,
      storeFallback: true,
      paymentId: requestedPaymentId ?? undefined,
      userId: currentUserId,
      ipHash,
      storeError: errorMessage,
    });
  };
  let cooldownMarked = false;
  let cooldownStoreName: string | undefined;
  let cooldownKey = "";

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    currentUserId = user.id;

    const paymentId = getPaymentId(request);
    if (!paymentId) return NextResponse.json({ error: "Identificador do pagamento ausente" }, { status: 400 });

    // MAI-138: teto por usuário + cooldown por (usuário, pagamento).
    if (limiterOn) {
      const userDecision = await checkBillingLimit(
        billingLimitKey("billing", "verify", "user", user.id),
        BILLING_LIMITS.verifyUser.limit,
        BILLING_LIMITS.verifyUser.windowMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      if (!userDecision.allowed) {
        if (userDecision.collapsed) {
          captureRateLimitHit({
            route: VERIFY_ROUTE,
            limitKind: "stores_collapsed",
            limit: BILLING_LIMITS.verifyUser.limit,
            windowMs: BILLING_LIMITS.verifyUser.windowMs,
            retryAfterSeconds: userDecision.retryAfterSeconds,
            paymentId,
            userId: user.id,
            storeName: userDecision.storeName,
            distributed: userDecision.distributed,
            storeFallback: userDecision.fallback,
            ipHash,
          });
          return buildBillingStoresCollapsedResponse(userDecision.retryAfterSeconds);
        }
        captureRateLimitHit({
          route: VERIFY_ROUTE,
          limitKind: "user",
          limit: BILLING_LIMITS.verifyUser.limit,
          windowMs: BILLING_LIMITS.verifyUser.windowMs,
          retryAfterSeconds: userDecision.retryAfterSeconds,
          paymentId,
          userId: user.id,
          storeName: userDecision.storeName,
          distributed: userDecision.distributed,
          storeFallback: userDecision.fallback,
          ipHash,
        });
        return buildBillingRateLimitedResponse(userDecision.retryAfterSeconds);
      }

      cooldownKey = billingLimitKey("billing", "verify", "cooldown", user.id, paymentId);
      const cooldown = await checkBillingCooldownAndMark(
        cooldownKey,
        BILLING_LIMITS.verifyPaymentCooldownMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      cooldownMarked = true;
      cooldownStoreName = cooldown.storeName;
      if (cooldown.collapsed) {
        captureRateLimitHit({
          route: VERIFY_ROUTE,
          limitKind: "stores_collapsed",
          limit: 1,
          windowMs: BILLING_LIMITS.verifyPaymentCooldownMs,
          retryAfterSeconds: BILLING_LIMITS.storesCollapsedRetryAfterSeconds,
          paymentId,
          userId: user.id,
          storeName: cooldown.storeName,
          distributed: cooldown.distributed,
          storeFallback: cooldown.fallback,
          ipHash,
        });
        return buildBillingStoresCollapsedResponse(BILLING_LIMITS.storesCollapsedRetryAfterSeconds);
      }
      if (cooldown.deduped) {
        captureRateLimitHit({
          route: VERIFY_ROUTE,
          limitKind: "payment_cooldown",
          limit: 1,
          windowMs: BILLING_LIMITS.verifyPaymentCooldownMs,
          retryAfterSeconds: Math.max(1, Math.ceil(BILLING_LIMITS.verifyPaymentCooldownMs / 1000)),
          paymentId,
          userId: user.id,
          storeName: cooldown.storeName,
          distributed: cooldown.distributed,
          storeFallback: cooldown.fallback,
          ipHash,
        });
        return buildBillingRateLimitedResponse(Math.ceil(BILLING_LIMITS.verifyPaymentCooldownMs / 1000));
      }
    }

    const releaseCooldown = () => {
      if (limiterOn && cooldownMarked && cooldownKey) {
        return releaseBillingCooldown(cooldownKey, cooldownStoreName).catch(() => undefined);
      }
      return Promise.resolve();
    };

    const paymentResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });
    if (!paymentResponse.ok) {
      await releaseCooldown();
      captureError(new Error(`Mercado Pago verify query failed with status ${paymentResponse.status}`), {
        route: "/api/mercadopago/verify",
        userId: user.id,
        paymentId,
        httpStatus: 502,
        extra: {
          upstream_status: paymentResponse.status,
        },
      });
      return NextResponse.json({ error: "Nao foi possivel consultar o pagamento no Mercado Pago" }, { status: 502 });
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPaymentPayload;

    if (!paymentBelongsToUser(payment, user.id)) {
      return NextResponse.json({ error: "Pagamento nao pertence a esta conta" }, { status: 403 });
    }

    if (payment.status !== "approved") {
      const months = Number(payment.metadata?.months || payment.external_reference?.split("#")[1] || 1);
      const validityDays = getValidityDays(months);

      // Reversao confirmada no provedor: reconcilia antes de responder.
      if (isReversalStatus(payment.status)) {
        try {
          const admin = createAdminClient();
          const result = await reconcileMercadoPagoReversal(admin, {
            paymentId,
            userId: user.id,
            reversalStatus: payment.status ?? "refunded",
            months,
            validityDays,
            amount: payment.transaction_amount ?? undefined,
          });
          const now = new Date();
          const active = Boolean(result.current_period_end && new Date(result.current_period_end) > now);
          return NextResponse.json({
            verified: true,
            payment_found: true,
            payment_processed_now: false,
            already_processed: result.already_reversed,
            subscription_active: active,
            subscription_status: active ? "active" : "expired",
            current_period_end: result.current_period_end,
            payment_status: payment.status ?? "unknown",
            activated: false,
            reversed: true,
            status: payment.status ?? "unknown",
          });
        } catch {
          // Fallback gracioso abaixo em caso de falha da RPC.
        }
      }

      if (isDisputeStatus(payment.status)) {
        let currentSub = null;
        try {
          const admin = createAdminClient();
          const { data } = await admin
            .from("subscriptions")
            .select("status, current_period_end")
            .eq("user_id", user.id)
            .maybeSingle();
          currentSub = data;
        } catch {
          // Fallback gracioso
        }
        const now = new Date();
        const isSubActive = Boolean(currentSub?.current_period_end && new Date(currentSub.current_period_end) > now);
        return NextResponse.json({
          verified: true,
          payment_found: true,
          payment_processed_now: false,
          already_processed: false,
          subscription_active: isSubActive,
          subscription_status: isSubActive ? "active" : (currentSub?.status || "expired"),
          current_period_end: currentSub?.current_period_end || null,
          payment_status: payment.status ?? "unknown",
          activated: false,
          needs_review: true,
          status: payment.status ?? "unknown",
        });
      }

      let currentSub = null;
      try {
        const admin = createAdminClient();
        const { data } = await admin
          .from("subscriptions")
          .select("status, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle();
        currentSub = data;
      } catch {
        // Fallback gracioso
      }

      const now = new Date();
      const isSubActive = Boolean(currentSub?.current_period_end && new Date(currentSub.current_period_end) > now);
      const subStatus = isSubActive ? "active" : (currentSub?.status || payment.status || "pending");

      return NextResponse.json({
        verified: true,
        payment_found: true,
        payment_processed_now: false,
        already_processed: false,
        subscription_active: isSubActive,
        subscription_status: subStatus,
        current_period_end: currentSub?.current_period_end || null,
        payment_status: payment.status ?? "unknown",
        activated: false,
        status: payment.status ?? "unknown",
      });
    }

    const admin = createAdminClient();
    const valResult = await validatePaymentBeforeGrantingPro(admin, payment, user.id);

    if (!valResult.valid) {
      if (valResult.forbidden) {
        return NextResponse.json({ error: "Pagamento nao pertence a esta conta" }, { status: 403 });
      }

      if (valResult.quarantine) {
        await quarantinePayment(admin, {
          paymentId,
          userId: user.id,
          reason: valResult.reason,
          amount: payment.transaction_amount,
          currency: payment.currency_id,
          months: payment.metadata?.months,
          rawPayload: payment as Record<string, unknown>,
        });
        captureError(new Error(`Pagamento em quarentena no verify: ${valResult.reason}`), {
          route: "/api/mercadopago/verify",
          userId: user.id,
          paymentId,
          httpStatus: 422,
          extra: { quarantine_reason: valResult.reason, details: valResult.details },
        });
        return NextResponse.json(
          {
            verified: false,
            quarantined: true,
            error: "Pagamento com inconsistência de valor ou moeda. Enviado para quarentena e análise.",
            reason: valResult.reason,
            status: "quarantined",
          },
          { status: 422 },
        );
      }

      return NextResponse.json(
        { verified: false, error: "Pagamento não aprovado para concessão de Pro." },
        { status: 400 },
      );
    }

    let result;
    try {
      result = await processMercadoPagoPayment(admin, {
        paymentId,
        userId: user.id,
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
          userId: user.id,
          reason: "checkout_already_completed",
          amount: payment.transaction_amount,
          currency: payment.currency_id,
          months: payment.metadata?.months,
          checkoutId: valResult.checkoutId,
          rawPayload: payment as Record<string, unknown>,
        });
        return NextResponse.json(
          {
            verified: false,
            quarantined: true,
            error: "Cotação já consumida por outro pagamento. Enviado para revisão.",
            reason: "checkout_already_completed",
            status: "quarantined",
          },
          { status: 422 },
        );
      }
      throw rpcError;
    }

    if (valResult.checkoutId) {
      await completeSubscriptionCheckout(admin, valResult.checkoutId, paymentId);
    }

    const now = new Date();
    const hasFutureEnd = Boolean(result.current_period_end && new Date(result.current_period_end) > now);
    const subscriptionActive = hasFutureEnd;
    const subscriptionStatus = hasFutureEnd ? "active" : "expired";
    const paymentProcessedNow = !result.already_processed;
    const isAlreadyProcessed = Boolean(result.already_processed);

    return NextResponse.json({
      verified: true,
      payment_found: true,
      payment_processed_now: paymentProcessedNow,
      already_processed: isAlreadyProcessed,
      subscription_active: subscriptionActive,
      subscription_status: subscriptionStatus,
      current_period_end: result.current_period_end,
      payment_status: payment.status ?? "approved",
      // Retrocompatibilidade
      activated: subscriptionActive,
      status: subscriptionStatus,
    });
  } catch (error) {
    if (limiterOn && cooldownMarked && cooldownKey) {
      await releaseBillingCooldown(cooldownKey, cooldownStoreName).catch(() => undefined);
    }
    captureError(error, {
      route: "/api/mercadopago/verify",
      userId: currentUserId,
      paymentId: requestedPaymentId || undefined,
      httpStatus: 500,
    });
    return NextResponse.json({ error: "Nao foi possivel conciliar o pagamento" }, { status: 500 });
  }
}
