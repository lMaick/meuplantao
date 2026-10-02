"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Calculator, Sparkles } from "lucide-react";

export function RoiCalculator() {
  const [plantoesPorMes, setPlantoesPorMes] = useState<number>(10);
  const [valorMedio, setValorMedio] = useState<number>(1700);

  const faturamentoMensal = plantoesPorMes * valorMedio;
  const faturamentoAnual = faturamentoMensal * 12;
  // Média estimada de inconsistências/repasses esquecidos em plantões sem controle formal (5%)
  const perdaEstimadaAnual = faturamentoAnual * 0.05;

  return (
    <section id="calculadora" className="py-16 md:py-24 bg-muted border-b border-border/80">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 shadow-xs mb-3">
            <Calculator className="size-3.5 text-emerald-600" />
            <span>Simulador de Volume Financeiro</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Quanto dinheiro passa pelos seus plantões?
          </h2>
          <p className="mt-3 text-muted-foreground text-base">
            Simule sua escala média e veja a importância de ter um controle rigoroso sobre cada repasse.
          </p>
        </div>

        {/* Calculator Card */}
        <div className="rounded-3xl border border-border bg-card p-6 sm:p-10 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            {/* Sliders Area */}
            <div className="flex flex-col gap-6">
              {/* Slider 1: Shifts per month */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="plantoes-input" className="text-sm font-bold text-foreground">
                    Plantões por mês
                  </label>
                  <span className="font-mono text-lg font-extrabold text-emerald-600">
                    {plantoesPorMes} plantões
                  </span>
                </div>
                <input
                  id="plantoes-input"
                  type="range"
                  min="2"
                  max="30"
                  step="1"
                  value={plantoesPorMes}
                  onChange={(e) => setPlantoesPorMes(Number(e.target.value))}
                  className="w-full h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                  <span>2 plantões</span>
                  <span>15 plantões</span>
                  <span>30 plantões</span>
                </div>
              </div>

              {/* Slider 2: Average shift value */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="valor-input" className="text-sm font-bold text-foreground">
                    Valor médio por plantão
                  </label>
                  <span className="font-mono text-lg font-extrabold text-emerald-600">
                    R$ {valorMedio.toLocaleString("pt-BR")}
                  </span>
                </div>
                <input
                  id="valor-input"
                  type="range"
                  min="800"
                  max="3500"
                  step="50"
                  value={valorMedio}
                  onChange={(e) => setValorMedio(Number(e.target.value))}
                  className="w-full h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                  <span>R$ 800</span>
                  <span>R$ 2.000</span>
                  <span>R$ 3.500+</span>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-800">Simule um cenário:</span> considere 5% de divergências ou atrasos nos repasses para dimensionar o impacto de valores não acompanhados de perto. Números ilustrativos — ajuste os controles ao seu caso.
              </div>
            </div>

            {/* Results Area */}
            <div className="flex flex-col justify-between rounded-2xl bg-slate-900 text-white p-6 sm:p-7 shadow-lg border border-slate-800">
              <div>
                <span className="text-xs uppercase tracking-wider font-semibold text-emerald-400">
                  Resumo Financeiro Anual
                </span>

                <div className="mt-4">
                  <span className="text-xs text-slate-400 block">Movimentação Anual em Plantões</span>
                  <p className="font-mono text-3xl sm:text-4xl font-extrabold text-white tracking-tight mt-1">
                    R$ {faturamentoAnual.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                  <span className="text-xs text-slate-400 mt-0.5 block">
                    (R$ {faturamentoMensal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} / mês)
                  </span>
                </div>

                <div className="mt-6 border-t border-slate-800 pt-5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-amber-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Cenário simulado (5%) — divergências ou atrasos:
                    </span>
                  </div>
                  <p className="font-mono text-xl sm:text-2xl font-bold text-amber-400 mt-1">
                    até R$ {perdaEstimadaAnual.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} / ano
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    O MeuPlantão ajuda a identificar pendentes, reunindo plantões, valores previstos e saldos em um só lugar.
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800">
                <Link
                  href="/cadastro"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-500 active:scale-98"
                >
                  Proteger Meus Repasses Agora
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
