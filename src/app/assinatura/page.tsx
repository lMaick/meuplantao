import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { SubscriptionCard } from "@/components/subscription";

export const metadata: Metadata = {
  title: "Assinatura & Planos | MeuPlantão",
  description: "Conheça os planos e garanta a gestão completa dos seus plantões e repasses.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SubscriptionPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
      <PageHeader
        title="Assinatura & Planos"
        description="Conheça os planos e garanta a gestão completa dos seus plantões e repasses."
      />

      <SubscriptionCard />
    </div>
  );
}
