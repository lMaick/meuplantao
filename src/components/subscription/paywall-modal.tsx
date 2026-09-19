"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CheckCircle2, Lock, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * PaywallModal (MAI-126): bloqueio funcional pós-trial com Motion Principles.
 * Entrada suave 200-300ms, backdrop blur, saída <200ms, touch targets 44px,
 * prefers-reduced-motion e foco gerenciado. Leitura do histórico preservada.
 */
export function PaywallModal({ open, onClose }: PaywallModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && dialogRef.current) {
        const controls = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled)",
          ),
        );
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <style>{`@media (prefers-reduced-motion: reduce) { .paywall-enter { animation: none !important; transition: none !important; } }`}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        aria-describedby="paywall-description"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "paywall-enter w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl",
          "animate-in fade-in slide-in-from-bottom-4 zoom-in-[0.98] duration-300 motion-reduce:animate-none",
          "max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary border border-primary/25">
            <Lock className="size-3.5" />
            Trial expirado
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <h2 id="paywall-title" className="mt-4 text-xl font-bold tracking-tight">
          Seu período de teste de 14 dias encerrou
        </h2>
        <p id="paywall-description" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Seu histórico e relatórios continuam disponíveis para leitura. Para criar ou editar
          novos plantões, ative o plano Pro por apenas{" "}
          <strong className="text-foreground">R$ 12,90/mês</strong>.
        </p>

        <ul className="mt-5 grid gap-2.5 text-sm">
          {[
            "Controle ilimitado de plantões, locais e contatos",
            "Alertas automáticos de atrasos e conciliação",
            "Extratos detalhados e exportação em CSV",
            "Sem fidelidade — cancele quando quiser",
          ].map((benefit) => (
            <li key={benefit} className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2.5">
          <Link
            href="/configuracoes?paywall=1"
            onClick={onClose}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-700/20 transition-all hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99]"
          >
            <Sparkles className="size-4" />
            Assinar MeuPlantão Pro — R$ 12,90/mês
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="min-h-[44px] w-full"
          >
            Continuar em modo leitura
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            PIX ou Cartão • Garantia de 7 dias ou seu dinheiro de volta
          </p>
        </div>
      </div>
    </div>
  );
}
