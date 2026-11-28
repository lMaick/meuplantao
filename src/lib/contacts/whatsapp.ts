// Funções puras para a cobrança de repasses pelo WhatsApp.
// Sem imports: o módulo precisa rodar direto no runner de testes (node --experimental-strip-types).

const BRAZIL_COUNTRY_CODE = "55";
const brlFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Normaliza um telefone brasileiro para o formato internacional só com dígitos (ex.: 5571999998888).
 * Aceita 10/11 dígitos locais (DDD + número) ou 12/13 dígitos já iniciados em 55.
 * Qualquer outro formato retorna null.
 */
export function normalizeBrazilianPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `${BRAZIL_COUNTRY_CODE}${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith(BRAZIL_COUNTRY_CODE)) return digits;
  return null;
}

function formatShiftDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}`;
}

export function buildChargeMessage({
  placeName,
  shiftDate,
  balance,
  daysOverdue,
}: {
  placeName: string;
  shiftDate: string;
  balance: number;
  daysOverdue: number;
}): string {
  // Intl usa espaço não separável (U+00A0) após "R$"; trocamos por espaço comum para o texto ficar limpo.
  const amount = brlFormatter.format(balance).replace(/ /g, " ");
  const days = daysOverdue === 1 ? "1 dia" : `${daysOverdue} dias`;
  return `Olá! Tudo bem? Estou conferindo meus repasses e o plantão de ${formatShiftDate(shiftDate)} em ${placeName}, no valor de ${amount}, consta em aberto há ${days}. Consegue me dar uma previsão de pagamento? Obrigado!`;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
