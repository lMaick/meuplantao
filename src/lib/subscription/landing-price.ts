import { getCanonicalPlanByMonths, PRICING_V2_CATALOG_VERSION } from "@/lib/mercadopago/payments";

/**
 * Preço mensal mostrado a visitantes (landing/FAQ, sem conta): sempre o do catálogo
 * mais novo, sem depender de relógio (quem se cadastra é conta nova). O corte é
 * sempre posterior ao deploy, então o erro só pode favorecer o cliente.
 */
export function getLandingMonthlyPriceLabel(): string {
  const plan = getCanonicalPlanByMonths(1, PRICING_V2_CATALOG_VERSION);
  return `R$ ${plan!.price.toFixed(2).replace(".", ",")}`;
}
