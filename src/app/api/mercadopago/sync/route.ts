import { NextResponse, type NextRequest } from "next/server";
import { getMercadoPagoAccessToken, getMercadoPagoApiUrl } from "@/lib/mercadopago/config";
import { createAdminClient, createAuthenticatedClient } from "@/lib/stripe/supabase";
import { calculateCumulativePeriodEnd } from "@/lib/subscription/trial";

export const runtime = "nodejs";

const validityDaysByMonths = new Map([[1, 30], [3, 90], [6, 180], [12, 365]]);

function addValidity(start: Date, days: number): Date {
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return end;
}

interface MercadoPagoSearchResult {
  results?: Array<{
    id?: string | number;
    status?: string;
    external_reference?: string;
    date_created?: string;
    date_approved?: string;
    transaction_amount?: number;
    metadata?: { user_id?: string; userId?: string; months?: number };
  }>;
}

export async function POST(request: NextRequest) {
  const sessionResponse = NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });

  try {
    const supabase = createAuthenticatedClient(request, sessionResponse);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Autenticacao obrigatoria" }, { status: 401 });
    }

    const searchUrl = `${getMercadoPagoApiUrl()}/v1/payments/search?external_reference=${encodeURIComponent(user.id)}&sort=date_created&criteria=desc&limit=50`;
    let paymentResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
    });

    if (!paymentResponse.ok) {
      return NextResponse.json(
        { error: "Nao foi possivel consultar pagamentos no Mercado Pago" },
        { status: 502 },
      );
    }

    const matchesUser = (p: NonNullable<MercadoPagoSearchResult["results"]>[number]) => {
      if (p.status !== "approved") return false;
      const [paymentUserId] = (p.external_reference || "").split("#");
      const ref = p.external_reference || p.metadata?.user_id || p.metadata?.userId;
      return !ref || ref === user.id || paymentUserId === user.id || p.metadata?.user_id === user.id || p.metadata?.userId === user.id;
    };

    let searchData = (await paymentResponse.json()) as MercadoPagoSearchResult;
    let userPayments = (searchData.results || []).filter(matchesUser);

    if (userPayments.length === 0) {
      const packageSearchResponse = await fetch(`${getMercadoPagoApiUrl()}/v1/payments/search?sort=date_created&criteria=desc&limit=50`, {
        headers: { Authorization: `Bearer ${getMercadoPagoAccessToken()}` },
      });
      if (packageSearchResponse.ok) {
        searchData = (await packageSearchResponse.json()) as MercadoPagoSearchResult;
        userPayments = (searchData.results || []).filter(matchesUser);
      }
    }

    if (userPayments.length > 0) {
      const latestPayment = userPayments[0];
      const months = Number(latestPayment.metadata?.months || latestPayment.external_reference?.split("#")[1] || 1);
      const isMultiPeriodPayment = Boolean(latestPayment.metadata?.months || latestPayment.external_reference?.includes("#"));
      const admin = createAdminClient();

      let currentPeriodEnd: string | null = null;
      if (isMultiPeriodPayment) {
        const validityDays = validityDaysByMonths.get(months) ?? validityDaysByMonths.get(1)!;
        const subscriptionTable = admin.from("subscriptions");
        const { data: currentSubscription } = await subscriptionTable.select("current_period_end").eq("user_id", user.id).maybeSingle();
        const currentEnd = currentSubscription?.current_period_end ? new Date(currentSubscription.current_period_end) : new Date();
        const start = currentEnd > new Date() ? currentEnd : new Date();
        currentPeriodEnd = addValidity(start, validityDays).toISOString();
      } else {
        currentPeriodEnd = calculateCumulativePeriodEnd(userPayments, new Date());
      }

      const subscriptionPayload = {
        user_id: user.id,
        status: "active" as const,
        ...(currentPeriodEnd ? { current_period_end: currentPeriodEnd } : {}),
      };

      const { error: subError } = await admin.from("subscriptions").upsert(
        subscriptionPayload,
        { onConflict: "user_id" },
      );
      if (subError) throw subError;

      return NextResponse.json({ synced: true, status: "active", current_period_end: currentPeriodEnd });
    }

    // Se nenhum pagamento aprovado foi encontrado, consulta o status atual
    const { data: currentSub } = await createAdminClient()
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const currentStatus = currentSub?.status || "trialing";
    return NextResponse.json({ synced: false, status: currentStatus });
  } catch (error) {
    console.error("Mercado Pago sync error", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Nao foi possivel sincronizar o status da assinatura" }, { status: 500 });
  }
}
