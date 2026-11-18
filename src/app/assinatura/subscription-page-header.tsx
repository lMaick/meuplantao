"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useIsTwa } from "@/lib/twa/use-is-twa";

export function SubscriptionPageHeader() {
  const isTwa = useIsTwa();

  if (isTwa) {
    return (
      <PageHeader
        title="Acesso da Conta"
        description="Consulte a situação de acesso da sua conta no MeuPlantão."
      />
    );
  }

  return (
    <div data-twa-hide="true">
      <PageHeader
        title="Assinatura & Planos"
        description="Conheça os planos e garanta a gestão completa dos seus plantões e repasses."
      />
    </div>
  );
}
