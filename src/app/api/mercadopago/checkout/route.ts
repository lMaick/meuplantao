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
import { getApplicationOrigin, getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { captureCheckoutError, captureRateLimitHit } from "@/lib/observability";
import { createAdminClient, createAuthenticatedClient } from "@/lib/supabase/server";
import { getCanonicalPlanByMonths } from "@/lib/mercadopago/payments";

export const runtime = "nodejs";

const CHECKOUT_ROUTE = "/api/mercadopago/checkout";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ error: "Nao foi possivel iniciar o checkout" }, { status: 500 });
  let currentUserId: string | undefined;

  // MAI-138: limitador distribuído (ligado em produção / opt-in em dev/teste).
  const limiterOn = isBillingRateLimitEnabled();
  const clientIp = limiterOn ? getClientIp(request) : "unknown";
  const ipHash = limiterOn ? hashIpForLog(clientIp) : "unknown";
  const logStoreFallback = (storeName: string, errorMessage: string) => {
    captureRateLimitHit({
      route: CHECKOUT_ROUTE,
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
  const userCooldownKey = () => billingLimitKey("billing", "checkout", "cooldown", currentUserId);

  // Teto por IP antes da autenticação (barato, sem custo de sessão).
  if (limiterOn) {
    const ipDecision = await checkBillingLimit(
      billingLimitKey("billing", "checkout", "ip", ipHash),
      BILLING_LIMITS.checkoutIp.limit,
      BILLING_LIMITS.checkoutIp.windowMs,
      ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
    );
    if (!ipDecision.allowed) {
      // MAI-138 (auditoria externa, bloqueador 1): colapso dos stores
      // distribuídos => fail-closed 503 + Retry-After, SEM consultar o MP.
      if (ipDecision.collapsed) {
        captureRateLimitHit({
          route: CHECKOUT_ROUTE,
          limitKind: "stores_collapsed",
          limit: BILLING_LIMITS.checkoutIp.limit,
          windowMs: BILLING_LIMITS.checkoutIp.windowMs,
          retryAfterSeconds: ipDecision.retryAfterSeconds,
          storeName: ipDecision.storeName,
          distributed: ipDecision.distributed,
          storeFallback: ipDecision.fallback,
          ipHash,
        });
        return buildBillingStoresCollapsedResponse(ipDecision.retryAfterSeconds);
      }
      captureRateLimitHit({
        route: CHECKOUT_ROUTE,
        limitKind: "ip",
        limit: BILLING_LIMITS.checkoutIp.limit,
        windowMs: BILLING_LIMITS.checkoutIp.windowMs,
        retryAfterSeconds: ipDecision.retryAfterSeconds,
        storeName: ipDecision.storeName,
        distributed: ipDecision.distributed,
        storeFallback: ipDecision.fallback,
        ipHash,
      });
      return buildBillingRateLimitedResponse(ipDecision.retryAfterSeconds);
    }
  }

  try {
    const supabase = createAuthenticatedClient(request, response);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    currentUserId = user.id;

    // MAI-138: teto + cooldown por usuário (evita N preferências/consultas ao MP).
    if (limiterOn) {
      const userDecision = await checkBillingLimit(
        billingLimitKey("billing", "checkout", "user", user.id),
        BILLING_LIMITS.checkoutUser.limit,
        BILLING_LIMITS.checkoutUser.windowMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      if (!userDecision.allowed) {
        if (userDecision.collapsed) {
          captureRateLimitHit({
            route: CHECKOUT_ROUTE,
            limitKind: "stores_collapsed",
            limit: BILLING_LIMITS.checkoutUser.limit,
            windowMs: BILLING_LIMITS.checkoutUser.windowMs,
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
          route: CHECKOUT_ROUTE,
          limitKind: "user",
          limit: BILLING_LIMITS.checkoutUser.limit,
          windowMs: BILLING_LIMITS.checkoutUser.windowMs,
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
        BILLING_LIMITS.checkoutUserCooldownMs,
        ({ storeName, errorMessage }) => logStoreFallback(storeName, errorMessage),
      );
      cooldownMarked = true;
      cooldownStoreName = cooldown.storeName;
      if (cooldown.collapsed) {
        captureRateLimitHit({
          route: CHECKOUT_ROUTE,
          limitKind: "stores_collapsed",
          limit: 1,
          windowMs: BILLING_LIMITS.checkoutUserCooldownMs,
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
          route: CHECKOUT_ROUTE,
          limitKind: "user_cooldown",
          limit: 1,
          windowMs: BILLING_LIMITS.checkoutUserCooldownMs,
          retryAfterSeconds: Math.max(1, Math.ceil(BILLING_LIMITS.checkoutUserCooldownMs / 1000)),
          userId: user.id,
          storeName: cooldown.storeName,
          distributed: cooldown.distributed,
          storeFallback: cooldown.fallback,
          ipHash,
        });
        return buildBillingRateLimitedResponse(Math.ceil(BILLING_LIMITS.checkoutUserCooldownMs / 1000));
      }
    }

    let subscription = null;
    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error) subscription = data;
    } catch {
      // Subscriptions table might not be migrated yet in remote db
    }

    const isRenewal = Boolean(subscription && subscription.status === "active");

    let months = 1;
    try {
      const body = (await request.json()) as { months?: number };
      months = body.months ?? 1;
    } catch {
      months = 1;
    }

    const plan = getCanonicalPlanByMonths(months);
    if (!plan) return NextResponse.json({ error: "Periodo de assinatura invalido" }, { status: 400 });

    const checkoutId = crypto.randomUUID();
    const admin = createAdminClient();

    if (admin && typeof admin.from === "function") {
      const { error: insertError } = await admin.from("subscription_checkouts").insert({
        id: checkoutId,
        user_id: user.id,
        plan_id: plan.id,
        months: plan.months,
        validity_days: plan.validityDays,
        amount: plan.price,
        amount_cents: plan.priceCents,
        currency: plan.currency,
        catalog_version: plan.catalogVersion,
        status: "pending",
        metadata: { is_renewal: isRenewal },
      });

      if (insertError) {
        captureCheckoutError(insertError, {
          route: "/api/mercadopago/checkout",
          userId: user.id,
          extra: { stage: "persist_checkout_quote", checkoutId },
        });
        return NextResponse.json(
          { error: "Falha ao registrar cotação do checkout. Operação abortada." },
          { status: 500 },
        );
      }
    }

    const origin = getApplicationOrigin(request.url);
    const isHttps = origin.startsWith("https://");
    const mercadoPagoResponse = await fetch(`${getMercadoPagoApiUrl()}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{
          id: plan.id,
          title: `MeuPlantão Pro — ${plan.label}`,
          description: `${isRenewal ? "Renovação" : "Assinatura"} do MeuPlantão Pro por ${plan.validityDays} dias`,
          quantity: 1,
          currency_id: plan.currency,
          unit_price: plan.price,
        }],
        external_reference: `${user.id}#${plan.months}#${checkoutId}`,
        metadata: {
          user_id: user.id,
          checkout_id: checkoutId,
          plan_id: plan.id,
          months: plan.months,
          currency: plan.currency,
          price: plan.price,
          price_cents: plan.priceCents,
          catalog_version: plan.catalogVersion,
          is_renewal: isRenewal,
        },
        payer: user.email ? { email: user.email } : undefined,
        back_urls: {
          success: `${origin}/configuracoes?payment=success`,
          pending: `${origin}/configuracoes?payment=pending`,
          failure: `${origin}/configuracoes?payment=failure`,
        },
        auto_return: isHttps ? "approved" : undefined,
        notification_url: isHttps ? `${origin}/api/webhooks/mercadopago` : undefined,
      }),
    });

    if (!mercadoPagoResponse.ok) throw new Error("Mercado Pago rejeitou a preferencia");
    const preference = await mercadoPagoResponse.json() as { id?: string; init_point?: string; sandbox_init_point?: string };
    const initPoint = preference.init_point || preference.sandbox_init_point;
    if (!initPoint) throw new Error("Mercado Pago nao retornou URL de checkout");

    // Vinculo verificavel checkout <-> preferencia (MAI-147: fail-closed).
    // Sem preference_id persistido, o pagamento futuro cai em quarentena;
    // abortar aqui evita entregar checkout sem lastro auditavel.
    if (!preference.id) {
      captureCheckoutError(new Error("Mercado Pago nao retornou ID da preferencia"), {
        route: "/api/mercadopago/checkout",
        userId: user.id,
        extra: { stage: "link_preference_id", checkoutId },
      });
      return NextResponse.json(
        { error: "Falha ao vincular preferência do checkout. Operação abortada." },
        { status: 500 },
      );
    }
    if (typeof admin?.from === "function") {
      try {
        const { error: updateError } = await admin
          .from("subscription_checkouts")
          .update({ preference_id: preference.id, init_point: initPoint })
          .eq("id", checkoutId);
        if (updateError) {
          captureCheckoutError(updateError, {
            route: "/api/mercadopago/checkout",
            userId: user.id,
            extra: { stage: "link_preference_id", checkoutId, preferenceId: preference.id },
          });
          return NextResponse.json(
            { error: "Falha ao vincular preferência do checkout. Operação abortada." },
            { status: 500 },
          );
        }
      } catch (linkError) {
        captureCheckoutError(linkError, {
          route: "/api/mercadopago/checkout",
          userId: user.id,
          extra: { stage: "link_preference_id", checkoutId, preferenceId: preference.id },
        });
        return NextResponse.json(
          { error: "Falha ao vincular preferência do checkout. Operação abortada." },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ init_point: initPoint });
  } catch (error) {
    // Falha retentável: libera o cooldown para o usuário tentar de novo de imediato.
    if (limiterOn && cooldownMarked && currentUserId) {
      await releaseBillingCooldown(userCooldownKey(), cooldownStoreName).catch(() => undefined);
    }
    captureCheckoutError(error, {
      route: "/api/mercadopago/checkout",
      userId: currentUserId,
    });
    return response;
  }
}
