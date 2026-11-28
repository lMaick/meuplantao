import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/config/site-url";
import { buildStructuredLog, captureError } from "@/lib/observability";
import { isCronAuthorized } from "@/lib/notifications/cron-auth";
import {
  getCalendarToday,
  planEmailForUser,
  renderEmail,
  type EmailPlan,
  type OpenObligation,
} from "@/lib/notifications/email-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTE = "/api/cron/email-alerts";
const MAX_SENDS_PER_RUN = 80;
const PAGE_SIZE = 1000;
const ID_CHUNK = 150;
const DEFAULT_FROM = "MeuPlantão <avisos@meuplantao.pro>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 10_000;

type Admin = ReturnType<typeof createAdminClient>;

interface Counters {
  users_with_open_balance: number;
  candidates: number;
  sent: number;
  failed: number;
  deferred: number;
  skipped_disabled: number;
  skipped_no_entitlement: number;
  skipped_no_email: number;
}

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function logInfo(message: string, extra: Record<string, unknown>) {
  const entry = buildStructuredLog(new Error(message), { route: ROUTE, level: "info", extra });
  console.info(JSON.stringify(entry));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface OpenRow {
  id: string;
  user_id: string;
  shift_id: string;
  saldo: number | string | null;
  data_prevista: string;
}

/**
 * A view `obligations_with_balance` NÃO exclui obrigações de plantões que voltaram
 * para agendado/cancelado (a obrigação permanece). Por isso só entram as ligadas
 * a plantão `realizado`, igual ao que o app mostra em /alertas.
 */
async function loadOpenObligations(admin: Admin): Promise<Map<string, Array<OpenObligation & { user_id: string }>>> {
  const rows: OpenRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("obligations_with_balance")
      .select("id,user_id,shift_id,saldo,data_prevista")
      .gt("saldo", 0)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as OpenRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const shiftInfo = new Map<string, { place_id: string | null }>();
  for (const ids of chunk([...new Set(rows.map((r) => r.shift_id))], ID_CHUNK)) {
    const { data, error } = await admin.from("shifts").select("id,place_id,status").in("id", ids);
    if (error) throw error;
    for (const s of data ?? []) {
      if (s.status === "realizado") shiftInfo.set(s.id as string, { place_id: (s.place_id as string | null) ?? null });
    }
  }

  const placeNames = new Map<string, string>();
  const placeIds = [...new Set([...shiftInfo.values()].map((s) => s.place_id).filter((v): v is string => !!v))];
  for (const ids of chunk(placeIds, ID_CHUNK)) {
    const { data, error } = await admin.from("places").select("id,nome").in("id", ids);
    if (error) throw error;
    for (const p of data ?? []) placeNames.set(p.id as string, p.nome as string);
  }

  const byUser = new Map<string, Array<OpenObligation & { user_id: string }>>();
  for (const row of rows) {
    const shift = shiftInfo.get(row.shift_id);
    if (!shift) continue;
    const list = byUser.get(row.user_id) ?? [];
    list.push({
      id: row.id,
      user_id: row.user_id,
      saldo: row.saldo === null ? null : Number(row.saldo),
      data_prevista: row.data_prevista,
      place_name: shift.place_id ? placeNames.get(shift.place_id) ?? null : null,
    });
    byUser.set(row.user_id, list);
  }
  return byUser;
}

interface Settings {
  enabled: boolean;
  unsubscribe_token: string;
  last_digest_on: string | null;
}

async function ensureAndLoadSettings(admin: Admin, userIds: string[]): Promise<Map<string, Settings>> {
  const result = new Map<string, Settings>();
  for (const ids of chunk(userIds, 200)) {
    const { error: upsertError } = await admin
      .from("email_notification_settings")
      .upsert(ids.map((user_id) => ({ user_id })), { onConflict: "user_id", ignoreDuplicates: true });
    if (upsertError) throw upsertError;
    const { data, error } = await admin
      .from("email_notification_settings")
      .select("user_id,enabled,unsubscribe_token,last_digest_on")
      .in("user_id", ids);
    if (error) throw error;
    for (const row of data ?? []) {
      result.set(row.user_id as string, {
        enabled: row.enabled as boolean,
        unsubscribe_token: row.unsubscribe_token as string,
        last_digest_on: (row.last_digest_on as string | null) ?? null,
      });
    }
  }
  return result;
}

async function loadNotifiedIds(admin: Admin, obligationIds: string[]): Promise<Set<string>> {
  const notified = new Set<string>();
  for (const ids of chunk(obligationIds, ID_CHUNK)) {
    const { data, error } = await admin.from("email_overdue_notices").select("obligation_id").in("obligation_id", ids);
    if (error) throw error;
    for (const row of data ?? []) notified.add(row.obligation_id as string);
  }
  return notified;
}

async function sendViaResend(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeApiUrl: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
      headers: {
        "List-Unsubscribe": `<${params.unsubscribeApiUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Nunca logar o corpo da resposta (pode ecoar o destinatário).
    captureError(new Error(`resend_http_${response.status}`), {
      route: ROUTE,
      level: "warning",
      httpStatus: response.status,
    });
    return false;
  }
  return true;
}

async function recordSent(admin: Admin, userId: string, plan: EmailPlan) {
  if (plan.newOverdue.length > 0) {
    const { error } = await admin
      .from("email_overdue_notices")
      .upsert(
        plan.newOverdue.map((item) => ({ obligation_id: item.id, user_id: userId })),
        { onConflict: "obligation_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }
  if (plan.kind === "digest") {
    const { error } = await admin
      .from("email_notification_settings")
      .update({ last_digest_on: plan.today, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw error;
  }
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return noStore({ error: "unauthorized" }, 401);
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    logInfo("email_alerts_skipped", { reason: "email_not_configured" });
    return noStore({ skipped: "email_not_configured" });
  }

  const counters: Counters = {
    users_with_open_balance: 0,
    candidates: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    skipped_disabled: 0,
    skipped_no_entitlement: 0,
    skipped_no_email: 0,
  };

  try {
    const admin = createAdminClient();
    const siteUrl = getSiteUrl({ requireConfig: true });
    const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
    const now = new Date();
    const today = getCalendarToday(now);

    const byUser = await loadOpenObligations(admin);
    const userIds = [...byUser.keys()].sort();
    counters.users_with_open_balance = userIds.length;
    if (userIds.length === 0) {
      logInfo("email_alerts_run", { ...counters });
      return noStore({ ok: true, ...counters });
    }

    const settings = await ensureAndLoadSettings(admin, userIds);
    const allObligationIds = userIds.flatMap((id) => (byUser.get(id) ?? []).map((o) => o.id));
    const notified = await loadNotifiedIds(admin, allObligationIds);

    const candidates: Array<{ userId: string; plan: EmailPlan; settings: Settings }> = [];
    for (const userId of userIds) {
      const userSettings = settings.get(userId);
      if (!userSettings || !userSettings.enabled) {
        counters.skipped_disabled += 1;
        continue;
      }
      const plan = planEmailForUser({
        now,
        obligations: byUser.get(userId) ?? [],
        notifiedIds: notified,
        lastDigestOn: userSettings.last_digest_on,
      });
      if (plan) candidates.push({ userId, plan, settings: userSettings });
    }
    counters.candidates = candidates.length;

    let attempts = 0;
    for (const candidate of candidates) {
      if (attempts >= MAX_SENDS_PER_RUN) {
        counters.deferred += 1;
        continue;
      }
      try {
        const { data: entitled, error: entitlementError } = await admin.rpc("has_active_entitlement", {
          p_user_id: candidate.userId,
        });
        if (entitlementError) throw entitlementError;
        if (entitled !== true) {
          counters.skipped_no_entitlement += 1;
          continue;
        }

        const { data: userData, error: userError } = await admin.auth.admin.getUserById(candidate.userId);
        if (userError) throw userError;
        const email = userData?.user?.email;
        if (!email) {
          counters.skipped_no_email += 1;
          continue;
        }

        const unsubscribeApiUrl = `${siteUrl}/api/email/unsubscribe?token=${candidate.settings.unsubscribe_token}`;
        const rendered = renderEmail(candidate.plan, {
          siteUrl,
          unsubscribeUrl: `${siteUrl}/descadastrar?token=${candidate.settings.unsubscribe_token}`,
        });

        attempts += 1;
        const ok = await sendViaResend({
          apiKey,
          from,
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          unsubscribeApiUrl,
          idempotencyKey: `meuplantao-${candidate.plan.kind}-${candidate.userId}-${today.iso}`,
        });
        if (!ok) {
          counters.failed += 1;
          continue;
        }
        counters.sent += 1;
        // Só depois do envio: reexecução no mesmo dia não reenvia.
        await recordSent(admin, candidate.userId, candidate.plan);
      } catch (error) {
        counters.failed += 1;
        captureError(error, { route: ROUTE, level: "error" });
      }
    }

    logInfo("email_alerts_run", { ...counters });
    return noStore({ ok: true, ...counters });
  } catch (error) {
    captureError(error, { route: ROUTE, level: "error", httpStatus: 500, extra: { ...counters } });
    return noStore({ error: "internal_error" }, 500);
  }
}
