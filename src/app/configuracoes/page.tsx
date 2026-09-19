import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SubscriptionCard } from "@/components/subscription";

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const payment = typeof params.payment === "string" ? params.payment : null;
  const paymentId = typeof params.payment_id === "string" ? params.payment_id : null;
  const collectionId = typeof params.collection_id === "string" ? params.collection_id : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
      <PageHeader
        title="Configurações"
        description="Personalize sua experiência e gerencie seu plano no MeuPlantão."
      />

      {/* Subscription & Plan Section */}
      <SubscriptionCard payment={payment} paymentId={paymentId ?? collectionId} />

      {/* App Preferences */}
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Preferências do Sistema</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajuste as opções visuais e de interface do aplicativo.
        </p>
        <div className="mt-5 border-t border-border/80 pt-5">
          <ThemeToggle />
        </div>
      </Card>
    </div>
  );
}
