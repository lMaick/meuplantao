import { getCatalogVersionForAccount } from "@/lib/mercadopago/payments";
import { getSubscriptionPeriod } from "./types";

/**
 * Preço mensal mostrado a visitantes (landing, sem conta): quem se cadastra agora
 * cai no catálogo vigente na data atual (v2 a partir do corte de PRICING_V2_CUTOFF_AT).
 */
export function getLandingMonthlyPriceLabel(now: Date = new Date()): string {
  const plan = getSubscriptionPeriod(1, getCatalogVersionForAccount(now));
  return `R$ ${(plan?.price ?? 12.9).toFixed(2).replace(".", ",")}`;
}
