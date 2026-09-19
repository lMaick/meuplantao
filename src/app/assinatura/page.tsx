import { PageHeader } from "@/components/ui/page-header";
import { SubscriptionCard } from "@/components/subscription";

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
