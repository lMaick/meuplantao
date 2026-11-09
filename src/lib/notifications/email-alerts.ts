/**
 * Avisos por e-mail (atraso + resumo semanal) — núcleo puro.
 *
 * Sem I/O, sem imports com alias: decide o que enviar e renderiza o e-mail.
 * A rota `/api/cron/email-alerts` apenas lê/grava no banco e chama o Resend.
 */

export const ALERTS_TIME_ZONE = "America/Bahia";
export const DIGEST_WEEKDAY = "Mon";
export const UPCOMING_WINDOW_DAYS = 7;
/** Máximo de linhas detalhadas por seção no e-mail; o restante vira "e mais N". */
export const MAX_LISTED_ITEMS = 8;

export interface OpenObligation {
  id: string;
  /** Saldo em reais (>= 0). */
  saldo: number | null;
  /** Data prevista no formato YYYY-MM-DD (calendário, sem fuso). */
  data_prevista: string;
  /** Nome do local; texto livre do usuário, escapado na renderização. */
  place_name?: string | null;
}

export interface CalendarToday {
  /** Hoje no fuso America/Bahia, YYYY-MM-DD. */
  iso: string;
  /** Segunda-feira em America/Bahia. */
  isMonday: boolean;
}

export interface PlanInput {
  now: Date;
  obligations: readonly OpenObligation[];
  /** IDs de obrigações que já receberam aviso de atraso. */
  notifiedIds: Iterable<string>;
  /** `last_digest_on` do usuário (YYYY-MM-DD) ou null. */
  lastDigestOn: string | null;
}

export interface OverdueItem {
  id: string;
  placeName: string;
  cents: number;
  dataPrevista: string;
  daysLate: number;
}

export interface UpcomingItem {
  id: string;
  placeName: string;
  cents: number;
  dataPrevista: string;
}

export interface DigestSummary {
  totalCents: number;
  overdueCents: number;
  upcomingCents: number;
  upcomingCount: number;
  upcoming: UpcomingItem[];
}

export type EmailPlan =
  | { kind: "overdue"; today: string; newOverdue: OverdueItem[] }
  | { kind: "digest"; today: string; newOverdue: OverdueItem[]; summary: DigestSummary };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FALLBACK_PLACE = "Local sem nome";

export function getCalendarToday(now: Date): CalendarToday {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: ALERTS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: ALERTS_TIME_ZONE, weekday: "short" }).format(now);
  return { iso, isMonday: weekday === DIGEST_WEEKDAY };
}

function isoToDayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date((isoToDayNumber(iso) + days) * 86_400_000).toISOString().slice(0, 10);
}

function toCents(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** Atrasada: saldo > 0 e data_prevista < hoje (hoje, no calendário de Bahia, não é atraso). */
export function isOverdueObligation(obligation: Pick<OpenObligation, "saldo" | "data_prevista">, todayIso: string): boolean {
  if (!ISO_DATE.test(obligation.data_prevista)) return false;
  return toCents(obligation.saldo) > 0 && obligation.data_prevista < todayIso;
}

export function planEmailForUser(input: PlanInput): EmailPlan | null {
  const today = getCalendarToday(input.now);
  const notified = new Set(input.notifiedIds);
  const open = input.obligations.filter(
    (o) => ISO_DATE.test(o.data_prevista) && toCents(o.saldo) > 0,
  );
  if (open.length === 0) return null;

  const windowEnd = addDaysIso(today.iso, UPCOMING_WINDOW_DAYS);
  const newOverdue: OverdueItem[] = [];
  const upcoming: UpcomingItem[] = [];
  let totalCents = 0;
  let overdueCents = 0;
  let upcomingCents = 0;

  for (const o of open) {
    const cents = toCents(o.saldo);
    const placeName = (o.place_name ?? "").trim() || FALLBACK_PLACE;
    totalCents += cents;
    if (isOverdueObligation(o, today.iso)) {
      overdueCents += cents;
      if (!notified.has(o.id)) {
        newOverdue.push({
          id: o.id,
          placeName,
          cents,
          dataPrevista: o.data_prevista,
          daysLate: isoToDayNumber(today.iso) - isoToDayNumber(o.data_prevista),
        });
      }
    } else if (o.data_prevista >= today.iso && o.data_prevista <= windowEnd) {
      upcomingCents += cents;
      upcoming.push({ id: o.id, placeName, cents, dataPrevista: o.data_prevista });
    }
  }

  newOverdue.sort((a, b) => b.daysLate - a.daysLate || a.id.localeCompare(b.id));
  upcoming.sort((a, b) => a.dataPrevista.localeCompare(b.dataPrevista) || a.id.localeCompare(b.id));

  if (today.isMonday && input.lastDigestOn !== today.iso && totalCents > 0) {
    return {
      kind: "digest",
      today: today.iso,
      newOverdue,
      summary: { totalCents, overdueCents, upcomingCents, upcomingCount: upcoming.length, upcoming },
    };
  }
  if (newOverdue.length > 0) return { kind: "overdue", today: today.iso, newOverdue };
  return null;
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatBrl(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}

export function formatIsoBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Texto livre vindo do usuário nunca quebra linha/cabeçalho no texto simples. */
function plainText(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

export interface RenderOptions {
  /** Origem canônica sem barra final, ex.: https://meuplantao.pro */
  siteUrl: string;
  /** Link de descadastro completo (página, nunca altera com GET). */
  unsubscribeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function buildSubject(plan: EmailPlan): string {
  if (plan.kind === "digest") return "Seu resumo da semana no MeuPlantão";
  const n = plan.newOverdue.length;
  return n === 1 ? "1 repasse passou da data prevista" : `${n} repasses passaram da data prevista`;
}

function overdueLine(item: OverdueItem): string {
  const days = `${item.daysLate} ${plural(item.daysLate, "dia", "dias")} de atraso`;
  return `${item.placeName} — ${formatBrl(item.cents)} (previsto para ${formatIsoBr(item.dataPrevista)}, ${days})`;
}

export function renderEmail(plan: EmailPlan, options: RenderOptions): RenderedEmail {
  const alertsUrl = `${options.siteUrl}/alertas`;
  const subject = buildSubject(plan);

  const intro =
    plan.kind === "digest"
      ? "Bom dia! Segunda-feira, hora de dar uma olhada no que você tem pra receber:"
      : "Oi! Passando pra avisar que alguns repasses já passaram da data prevista:";

  const listedOverdue = plan.newOverdue.slice(0, MAX_LISTED_ITEMS);
  const hiddenOverdue = plan.newOverdue.length - listedOverdue.length;
  const overdueTitle =
    plan.kind === "digest" ? "Novos atrasos desde o último aviso" : "Repasses em atraso";

  const textLines: string[] = [intro, ""];
  const htmlParts: string[] = [`<p style="margin:0 0 16px">${escapeHtml(intro)}</p>`];

  if (plan.kind === "digest") {
    const s = plan.summary;
    const rows: Array<[string, string]> = [
      ["Total a receber", formatBrl(s.totalCents)],
      ["Em atraso", formatBrl(s.overdueCents)],
      [`Previsto nos próximos ${UPCOMING_WINDOW_DAYS} dias`, formatBrl(s.upcomingCents)],
    ];
    for (const [label, value] of rows) textLines.push(`${label}: ${value}`);
    textLines.push("");
    htmlParts.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px">` +
        rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#4b5563">${escapeHtml(label)}</td>` +
              `<td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`,
          )
          .join("") +
        `</table>`,
    );
  }

  if (listedOverdue.length > 0) {
    textLines.push(`${overdueTitle}:`);
    for (const item of listedOverdue) textLines.push(`- ${plainText(overdueLine(item))}`);
    if (hiddenOverdue > 0) textLines.push(`- e mais ${hiddenOverdue}`);
    textLines.push("");
    htmlParts.push(
      `<h2 style="font-size:16px;margin:0 0 8px">${escapeHtml(overdueTitle)}</h2>` +
        `<ul style="margin:0 0 20px;padding-left:20px">` +
        listedOverdue.map((item) => `<li style="margin:0 0 6px">${escapeHtml(overdueLine(item))}</li>`).join("") +
        (hiddenOverdue > 0 ? `<li style="margin:0 0 6px">e mais ${hiddenOverdue}</li>` : "") +
        `</ul>`,
    );
  }

  if (plan.kind === "digest" && plan.summary.upcoming.length > 0) {
    const listed = plan.summary.upcoming.slice(0, MAX_LISTED_ITEMS);
    const hidden = plan.summary.upcoming.length - listed.length;
    const line = (u: UpcomingItem) => `${u.placeName} — ${formatBrl(u.cents)} (previsto para ${formatIsoBr(u.dataPrevista)})`;
    textLines.push(`Previstos para os próximos ${UPCOMING_WINDOW_DAYS} dias:`);
    for (const u of listed) textLines.push(`- ${plainText(line(u))}`);
    if (hidden > 0) textLines.push(`- e mais ${hidden}`);
    textLines.push("");
    htmlParts.push(
      `<h2 style="font-size:16px;margin:0 0 8px">Previstos para os próximos ${UPCOMING_WINDOW_DAYS} dias</h2>` +
        `<ul style="margin:0 0 20px;padding-left:20px">` +
        listed.map((u) => `<li style="margin:0 0 6px">${escapeHtml(line(u))}</li>`).join("") +
        (hidden > 0 ? `<li style="margin:0 0 6px">e mais ${hidden}</li>` : "") +
        `</ul>`,
    );
  }

  const closing = "Quando der, abre o MeuPlantão e confere se algum repasse já caiu na conta.";
  textLines.push(closing, "", `Ver alertas: ${alertsUrl}`, "", "Você recebe este e-mail porque tem uma conta no MeuPlantão.", `Não quer mais receber? Descadastre aqui: ${options.unsubscribeUrl}`);

  htmlParts.push(
    `<p style="margin:0 0 20px">${escapeHtml(closing)}</p>`,
    `<p style="margin:0 0 24px"><a href="${escapeHtml(alertsUrl)}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Ver meus alertas</a></p>`,
    `<p style="margin:0;font-size:12px;color:#6b7280">Você recebe este e-mail porque tem uma conta no MeuPlantão. ` +
      `<a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#6b7280">Descadastrar</a></p>`,
  );

  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#ffffff;border-radius:12px;padding:24px;font-size:15px;line-height:1.5">` +
    `<p style="margin:0 0 16px;font-weight:700;color:#0f766e">MeuPlantão</p>` +
    htmlParts.join("") +
    `</div></div></body></html>`;

  return { subject, html, text: textLines.join("\n") };
}
