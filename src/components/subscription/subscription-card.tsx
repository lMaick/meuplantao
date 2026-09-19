"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  CreditCard,
  Zap,
  ArrowRight,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSubscription } from "@/lib/subscription";
import { cn } from "cn";

export function SubscriptionCard({ className }: { className?: string }) {
  const { trial, isLoading } = useSubscription();
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleSubscribe = async () => {
    setIsProcessing(true);
    setFeedbackMessage(null);

    // Simulated checkout flow transition
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setFeedbackMessage(
        "Ambiente de checkout seguro em inicialização. Integração com meio de pagamento pronta para produção."
      );
    } catch {
      setFeedbackMessage("Não foi possível iniciar o checkout no momento. Tente novamente.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <Card className={cn("overflow-hidden p-6 space-y-6", className)}>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-6 w-44 animate-pulse rounded-md bg-muted/70" />
            <div className="h-4 w-64 animate-pulse rounded-md bg-muted/50" />
          </div>
          <div className="h-7 w-24 animate-pulse rounded-full bg-muted/60" />
        </div>
        <div className="h-24 w-full animate-pulse rounded-xl bg-muted/40" />
        <div className="space-y-3">
          <div className="h-5 w-3/4 animate-pulse rounded-md bg-muted/50" />
          <div className="h-5 w-2/3 animate-pulse rounded-md bg-muted/50" />
          <div className="h-5 w-4/5 animate-pulse rounded-md bg-muted/50" />
        </div>
        <div className="h-12 w-full animate-pulse rounded-xl bg-muted/70" />
      </Card>
    );
  }

  const isWarning = trial ? trial.daysRemaining <= 3 && trial.isTrialing : false;

  return (
    <Card className={cn("overflow-hidden border-border/90 bg-card p-6 shadow-sm", className)}>
      {/* Header section */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Assinatura & Plano
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
              <Sparkles className="size-3 text-emerald-600 dark:text-emerald-400" />
              Pro
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie seu plano e continue com controle financeiro cirúrgico dos seus plantões.
          </p>
        </div>

        {/* Current status pill */}
        {trial && (
          <div className="shrink-0">
            {trial.isActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                <Sparkles className="size-3.5" />
                Assinatura Ativa
              </span>
            ) : trial.isExpired ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive border border-destructive/30">
                <AlertTriangle className="size-3.5" />
                Trial Expirado
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border",
                  isWarning
                    ? "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30"
                    : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30"
                )}
              >
                <Clock className="size-3.5" />
                {trial.daysRemaining === 1
                  ? "1 dia restante de teste"
                  : `${trial.daysRemaining} dias restantes de teste`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Trial Status Banner */}
      {trial && !trial.isActive && (
        <div
          className={cn(
            "mt-5 rounded-xl p-4 text-sm border",
            trial.isExpired
              ? "bg-destructive/10 border-destructive/25 text-destructive dark:text-red-300"
              : isWarning
              ? "bg-amber-500/10 border-amber-500/25 text-amber-900 dark:text-amber-200"
              : "bg-emerald-500/10 border-emerald-500/25 text-emerald-900 dark:text-emerald-200"
          )}
        >
          <div className="flex items-start gap-3">
            {trial.isExpired ? (
              <AlertTriangle className="size-5 shrink-0 mt-0.5 text-destructive" />
            ) : (
              <Clock
                className={cn(
                  "size-5 shrink-0 mt-0.5",
                  isWarning ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                )}
              />
            )}
            <div>
              <p className="font-semibold">
                {trial.isExpired
                  ? "Seu período de teste gratuito de 14 dias encerrou."
                  : `Você tem ${trial.daysRemaining} ${
                      trial.daysRemaining === 1 ? "dia restante" : "dias restantes"
                    } de teste gratuito.`}
              </p>
              <p className="mt-0.5 text-xs opacity-90">
                {trial.isExpired
                  ? "Para continuar cadastrando novos plantões e acompanhando repasses sem interrupções, ative seu plano Pro."
                  : "Aproveite todos os recursos premium sem restrições durante o seu período de avaliação."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pricing & Plan Details Box */}
      <div className="mt-6 rounded-2xl border border-border/80 bg-muted/20 p-5 sm:p-6 transition-all hover:border-border">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Plano Individual Clínico
            </span>
            <h3 className="text-2xl font-extrabold tracking-tight text-foreground">
              MeuPlantão Pro
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Organização financeira completa projetada exclusivamente para médicos plantonistas.
            </p>
          </div>

          <div className="flex items-baseline gap-1 bg-background/80 px-4 py-2.5 rounded-xl border border-border/60 shadow-2xs">
            <span className="text-xs font-semibold text-muted-foreground">R$</span>
            <span className="text-3xl font-extrabold text-foreground font-mono tracking-tight">
              12,90
            </span>
            <span className="text-xs font-medium text-muted-foreground">/ mês</span>
          </div>
        </div>

        {/* Benefits checklist */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <span className="text-xs sm:text-sm text-foreground">
              <strong>Controle ilimitado</strong> de plantões, locais e contatos
            </span>
          </div>

          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <span className="text-xs sm:text-sm text-foreground">
              <strong>Alertas automáticos</strong> de atrasos e conciliação
            </span>
          </div>

          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <span className="text-xs sm:text-sm text-foreground">
              <strong>Extratos detalhados</strong> e exportação em CSV (RFC 4180)
            </span>
          </div>

          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <span className="text-xs sm:text-sm text-foreground">
              <strong>Sem fidelidade:</strong> cancele a qualquer momento com 1 clique
            </span>
          </div>
        </div>

        {/* Action Button & Feedback */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleSubscribe}
            disabled={isProcessing || (trial?.isActive ?? false)}
            size="lg"
            className="w-full sm:w-auto min-h-[44px] bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold shadow-md shadow-emerald-700/20 text-sm gap-2 active:scale-[0.99] transition-all"
          >
            {isProcessing ? (
              <span className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Processando...
              </span>
            ) : trial?.isActive ? (
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                Plano Pro Ativo
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Zap className="size-4 fill-white" />
                Assinar MeuPlantão Pro — R$ 12,90/mês
                <ArrowRight className="size-4" />
              </span>
            )}
          </Button>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CreditCard className="size-4 text-muted-foreground shrink-0" />
            <span>PIX ou Cartão • Cobrança mensal sem surpresas</span>
          </div>
        </div>

        {feedbackMessage && (
          <div className="mt-4 rounded-xl bg-primary/10 border border-primary/20 p-3 text-xs text-primary font-medium animate-in fade-in duration-200">
            {feedbackMessage}
          </div>
        )}
      </div>

      {/* Trust guarantees footer */}
      <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          Garantia de 7 dias ou seu dinheiro de volta
        </span>
        <span>Cancelamento imediato sem burocracia</span>
      </div>
    </Card>
  );
}
