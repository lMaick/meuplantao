import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/landing-header";
import { HeroSection } from "@/components/landing/hero-section";
import { InteractivePreview } from "@/components/landing/interactive-preview";
import { PainVsSolution } from "@/components/landing/pain-vs-solution";
import { RoiCalculator } from "@/components/landing/roi-calculator";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { FaqSection } from "@/components/landing/faq-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { PricingSection } from "@/components/landing/pricing-section";

export const metadata: Metadata = {
  title: "MeuPlantão | Controle financeiro inteligente para quem vive de plantão",
  description:
    "Organize seus plantões médicos e de saúde, identifique repasses atrasados e controle pagamentos parciais em múltiplos hospitais sem planilhas confusas.",
};

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <LandingHeader />
      <main className="flex-1">
        <HeroSection />
        <InteractivePreview />
        <PainVsSolution />
        <RoiCalculator />
        <PricingSection />
        <FeaturesGrid />
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  );
}
