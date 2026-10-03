import { ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SubscriptionCard } from "@/components/subscription";
import { LogoutButton } from "@/lib/auth/logout-button";

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

      {/* Account & Session */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-foreground">Conta &amp; Sessão</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Encerre a sessão neste dispositivo para trocar de conta com segurança. Você será
              redirecionado para /login.
            </p>
          </div>
        </div>
        <div className="mt-5 border-t border-border/80 pt-5">
          <LogoutButton variant="destructive" className="w-full sm:w-auto" />
          <p className="mt-3 text-xs text-muted-foreground">
            O logout encerra a sessão no Supabase apenas neste navegador.
          </p>
        </div>
      </Card>
    </div>
  );
}
