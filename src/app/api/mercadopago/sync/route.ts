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
import { captureRateLimitHit, captureSyncError } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SYNC_ROUTE = "/api/mercadopago/sync";

interface MercadoPagoSearchResult {
  results?: Array<{
    id?: string | number;
    status?: string;
    currency_id?: string;
    external_reference?: string;
    date_created?: string;
    date_approved?: string;
    transaction_amount?: number;
    preference_id?: string | null;
    metadata?: { user_id?: string; userId?: string; months?: number };
    items?: Array<{ id?: string; unit_price?: number; quantity?: number }>;
    additional_info?: { items?: Array<{ id?: string; unit_price?: number; quantity?: number }> };
  }>;
}

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });
  let currentUserId: string | undefined;

  // MAI-138: limitador distribuído (ligado em produção / opt-in em dev/teste).
  const limiterOn = isBillingRateLimitEnabled();
  const clientIp = limiterOn ? getClientIp(request) : "unknown";
  const ipHash = limiterOn ? hashIpForLog(clientIp) : "unknown";
  const logStoreFallback = (storeName: string, errorMessage: string) => {
    captureRateLimitHit({
      route: SYNC_ROUTE,
      limitKind: "store_fallback",
      limit: 0,
      windowMs: 0,
      storeName,
      distributed: false,
      storeFallback: true,
      userId: currentUserId,
      ipHash,
      storeError: errorMessage,
    });
  };
  let cooldownMarked = false;
  let cooldownStoreName: string | undefined;
  const userCooldownKey = () => billingLimitKey("billing", "sync", "cooldown", currentUserId);

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    }
    currentUserId = user.id;

    // MAI-138: teto + cooldown por usuário (cada sync dispara até 2 buscas no MP).
    if (limiterOn) {
      const userDecision = await checkBillingLimit(
        billingLimitKey("billing", "sync", "user", user.id),
        BILLING_LIMITS.syncUser.limit,
        BILLING_LIMITS.syncUser.windowMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      if (!userDecision.allowed) {
        if (userDecision.collapsed) {
          captureRateLimitHit({
            route: SYNC_ROUTE,
            limitKind: "stores_collapsed",
            limit: BILLING_LIMITS.syncUser.limit,
            windowMs: BILLING_LIMITS.syncUser.windowMs,
            retryAfterSeconds: userDecision.retryAfterSeconds,
            userId: user.id,
            storeName: userDecision.storeName,
            distributed: userDecision.distributed,
            storeFallback: userDecision.fallback,
            ipHash,
          });
          return buildBillingStoresCollapsedResponse(userDecision.retryAfterSeconds);
        }
        captureRateLimitHit({
          route: SYNC_ROUTE,
          limitKind: "user",
          limit: BILLING_LIMITS.syncUser.limit,
          windowMs: BILLING_LIMITS.syncUser.windowMs,
          retryAfterSeconds: userDecision.retryAfterSeconds,
          userId: user.id,
          storeName: userDecision.storeName,
          distributed: userDecision.distributed,
          storeFallback: userDecision.fallback,
          ipHash,
        });
        return buildBillingRateLimitedResponse(userDecision.retryAfterSeconds);
      }

      const cooldown = await checkBillingCooldownAndMark(
        userCooldownKey(),
        BILLING_LIMITS.syncUserCooldownMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      cooldownMarked = true;
      cooldownStoreName = cooldown.storeName;
      if (cooldown.collapsed) {
        captureRateLimitHit({
          route: SYNC_ROUTE,
          limitKind: "stores_collapsed",
          limit: 1,
          windowMs: BILLING_LIMITS.syncUserCooldownMs,
          retryAfterSeconds: BILLING_LIMITS.storesCollapsedRetryAfterSeconds,
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
          route: SYNC_ROUTE,
          limitKind: "user_cooldown",
          limit: 1,
          windowMs: BILLING_LIMITS.syncUserCooldownMs,
          retryAfterSeconds: Math.max(1, Math.ceil(BILLING_LIMITS.syncUserCooldownMs / 1000)),
          userId: user.id,
          storeName: cooldown.storeName,
          distributed: cooldown.distributed,
          storeFallback: cooldown.fallback,
          ipHash,
        });
        return buildBillingRateLimitedResponse(Math.ceil(BILLING_LIMITS.syncUserCooldownMs / 1000));
      }
    }

    const releaseCooldown = () => {
      if (limiterOn && cooldownMarked && currentUserId) {
        return releaseBillingCooldown(userCooldownKey(), cooldownStoreName).catch(() => undefined);
      }
      return Promise.resolve();
    };

    const searchUrl = `${getMercadoPagoApiUrl()}/v1/payments/search?external_reference=${encodeURIComponent(user.id)}&sort=date_created&criteria=desc&limit=50`;
    const paymentResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });

    if (!paymentResponse.ok) {
      await releaseCooldown();
      captureSyncError(new Error(`Mercado Pago search query failed with status ${paymentResponse.status}`), {
        route: "/api/mercadopago/sync",
        userId: user.id,
        httpStatus: 502,
        extra: {
          upstream_status: paymentResponse.status,
          search_stage: "user_payments_search",
        },
      });
      return NextResponse.json(
        { error: "Nao foi possivel consultar pagamentos no Mercado Pago" },
        { status: 502 },
      );
    }

    const matchesUser = (p: NonNullable<MercadoPagoSearchResult["results"]>[number]) => {
      const st = (p.status || "").toLowerCase();
      if (st !== "approved" && !isReversalStatus(st) && !isDisputeStatus(st)) return false;
      return paymentBelongsToUser(p, user.id);
    };

    let searchData = (await paymentResponse.json()) as MercadoPagoSearchResult;
    let userPayments = (searchData.results || []).filter(matchesUser);

    if (userPayments.length === 0) {
      const packageSearchResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/search?sort=date_created&criteria=desc&limit=50`, {
        headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
      });
      if (!packageSearchResponse.ok) {
        await releaseCooldown();
        captureSyncError(new Error(`Mercado Pago fallback search failed with status ${packageSearchResponse.status}`), {
          route: "/api/mercadopago/sync",
          userId: user.id,
          httpStatus: 502,
          extra: {
            upstream_status: packageSearchResponse.status,
            search_stage: "fallback_payments_search",
          },
        });
        return NextResponse.json(
          { error: "Nao foi possivel consultar pagamentos no Mercado Pago" },
          { status: 502 },
        );
      }
      searchData = (await packageSearchResponse.json()) as MercadoPagoSearchResult;
      userPayments = (searchData.results || []).filter(matchesUser);
    }

    if (userPayments.length > 0) {
      // Deduplica por ID de pagamento
      const uniquePaymentsMap = new Map<string, NonNullable<MercadoPagoSearchResult["results"]>[number]>();
      for (const p of userPayments) {
        if (p.id) {
          uniquePaymentsMap.set(String(p.id), p);
        }
      }
      const uniquePayments = Array.from(uniquePaymentsMap.values());

      // Ordena cronologicamente (do mais antigo para o mais novo) para aplicar na ordem de aquisição
      uniquePayments.sort((a, b) => {
        const timeA = new Date(a.date_approved || a.date_created || 0).getTime();
        const timeB = new Date(b.date_approved || b.date_created || 0).getTime();
        return timeA - timeB;
      });

      const admin = createAdminClient();
      let newlyProcessedCount = 0;
      let validPaymentsCount = 0;
      let lastResultPeriodEnd: string | null = null;
      let reversedCount = 0;
      let needsReviewCount = 0;

      for (const p of uniquePayments) {
        const paymentId = String(p.id);

        // Reversao confirmada no provedor tem precedencia sobre o aprovado local:
        // reconcilia primeiro para que evento antigo nao restaure Pro.
        if (isReversalStatus(p.status)) {
          const months = Number(p.metadata?.months || p.external_reference?.split("#")[1] || 1);
          const validityDays = getValidityDays(months);
          const result = await reconcileMercadoPagoReversal(admin, {
            paymentId,
            userId: user.id,
            reversalStatus: p.status ?? "refunded",
            months,
            validityDays,
            amount: p.transaction_amount ?? undefined,
          });
          if (result.reversed) reversedCount += 1;
          lastResultPeriodEnd = result.current_period_end;
          continue;
        }

        if (isDisputeStatus(p.status)) {
          needsReviewCount += 1;
          continue;
        }

        if (p.status !== "approved") {
          continue;
        }

        // Validação financeira rigorosa antes de aplicar qualquer concessão (MAI-137)
        const valResult = await validatePaymentBeforeGrantingPro(admin, p as MercadoPagoPaymentPayload, user.id);

        if (!valResult.valid) {
          if (valResult.quarantine) {
            await quarantinePayment(admin, {
              paymentId,
              userId: user.id,
              reason: valResult.reason,
              amount: p.transaction_amount,
              currency: p.currency_id,
              months: p.metadata?.months,
              rawPayload: p as Record<string, unknown>,
            });
          }
          continue;
        }

        validPaymentsCount += 1;

        let result;
        try {
          result = await processMercadoPagoPayment(admin, {
            paymentId,
            userId: user.id,
            months: valResult.months,
            validityDays: valResult.validityDays,
            amount: valResult.amount,
            status: p.status ?? "approved",
            checkoutId: valResult.checkoutId,
          });
        } catch (rpcError) {
          if (isQuoteConsumedError(rpcError)) {
            await quarantinePayment(admin, {
              paymentId,
              userId: user.id,
              reason: "checkout_already_completed",
              amount: p.transaction_amount,
              currency: p.currency_id,
              months: p.metadata?.months,
              checkoutId: valResult.checkoutId,
              rawPayload: p as Record<string, unknown>,
            });
            needsReviewCount += 1;
            continue;
          }
          throw rpcError;
        }

        if (valResult.checkoutId) {
          await completeSubscriptionCheckout(admin, valResult.checkoutId, paymentId);
        }

        if (!result.already_processed) {
          newlyProcessedCount += 1;
        }
        lastResultPeriodEnd = result.current_period_end;
      }

      // Consulta o registro atualizado da assinatura
      let currentSub = null;
      try {
        const subQuery = admin.from("subscriptions");
        if (typeof subQuery?.select === "function") {
          const { data } = await subQuery
            .select("status, current_period_end")
            .eq("user_id", user.id)
            .maybeSingle();
          currentSub = data;
        }
      } catch {
        // Fallback gracioso
      }

      const finalPeriodEnd = currentSub?.current_period_end || lastResultPeriodEnd;

      const now = new Date();
      const isSubscriptionActive = Boolean(finalPeriodEnd && new Date(finalPeriodEnd) > now);
      const derivedStatus = isSubscriptionActive ? "active" : "expired";

      return NextResponse.json({
        synced: true,
        payment_found: validPaymentsCount > 0,
        payment_processed_now: newlyProcessedCount > 0,
        already_processed: newlyProcessedCount === 0 && validPaymentsCount > 0,
        subscription_active: isSubscriptionActive,
        subscription_status: derivedStatus,
        current_period_end: finalPeriodEnd,
        newly_processed: newlyProcessedCount,
        reversed: reversedCount,
        needs_review: needsReviewCount,
        total_payments: validPaymentsCount,
        status: derivedStatus,
      });
    }

    // Se nenhum pagamento aprovado foi encontrado, consulta o status atual
    let currentSub = null;
    try {
      const subQuery = createAdminClient().from("subscriptions");
      if (typeof subQuery?.select === "function") {
        const { data } = await subQuery
          .select("status, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle();
        currentSub = data;
      }
    } catch {
      // Fallback
    }

    const now = new Date();
    const isSubActive = Boolean(currentSub?.current_period_end && new Date(currentSub.current_period_end) > now);
    const currentStatus = isSubActive
      ? "active"
      : (currentSub?.current_period_end ? "expired" : (currentSub?.status || "trialing"));

    return NextResponse.json({
      synced: false,
      payment_found: false,
      payment_processed_now: false,
      already_processed: false,
      subscription_active: isSubActive,
      subscription_status: currentStatus,
      current_period_end: currentSub?.current_period_end || null,
      newly_processed: 0,
      total_payments: 0,
      status: currentStatus,
    });
  } catch (error) {
    if (limiterOn && cooldownMarked && currentUserId) {
      await releaseBillingCooldown(userCooldownKey(), cooldownStoreName).catch(() => undefined);
    }
    captureSyncError(error, {
      route: "/api/mercadopago/sync",
      userId: currentUserId,
    });
    return NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });
  }
}
