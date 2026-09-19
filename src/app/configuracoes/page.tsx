import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <PageHeader title="Configurações" description="Personalize sua experiência no MeuPlantao." />
      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Preferências</h2>
        <div className="mt-5 border-t border-border pt-5">
          <ThemeToggle />
        </div>
      </Card>
    </div>
  );
}
