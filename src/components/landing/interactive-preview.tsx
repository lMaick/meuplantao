"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Copy, Filter, Hospital } from "lucide-react";

interface MockShift {
  id: string;
  hospital: string;
  setor: string;
  data: string;
  horario: string;
  valor: number;
  status: "pago" | "pendente" | "atrasado";
  previsao: string;
  responsavel: string;
}

const mockShifts: MockShift[] = [
  {
    id: "1",
    hospital: "Hospital São Lucas",
    setor: "UTI Geral (12h Noturno)",
    data: "04 de Outubro",
    horario: "19:00 às 07:00",
    valor: 1900,
    status: "pago",
    previsao: "Pago em 10/10",
    responsavel: "Dra. Camila (Coordenação)",
  },
  {
    id: "2",
    hospital: "UPA 24h Central",
    setor: "Emergência Clínica (12h Diurno)",
    data: "08 de Outubro",
    horario: "07:00 às 19:00",
    valor: 1550,
    status: "pendente",
    previsao: "Vence em 3 dias (18/10)",
    responsavel: "Dra. Renata (Escala)",
  },
  {
    id: "3",
    hospital: "Hospital Santa Clara",
    setor: "Pronto-Socorro (12h Noturno)",
    data: "28 de Setembro",
    horario: "19:00 às 07:00",
    valor: 2100,
    status: "atrasado",
    previsao: "Atrasado há 5 dias (era 10/10)",
    responsavel: "Dr. Marcos (Repasse)",
  },
];

export function InteractivePreview() {
  const [activeFilter, setActiveFilter] = useState<"todos" | "pendentes" | "atrasados">("todos");
  const [copied, setCopied] = useState(false);

  const filteredShifts = mockShifts.filter((shift) => {
    if (activeFilter === "todos") return true;
    if (activeFilter === "pendentes") return shift.status === "pendente" || shift.status === "atrasado";
    if (activeFilter === "atrasados") return shift.status === "atrasado";
    return true;
  });

  const handleCopyChargeMessage = () => {
    const text = "Olá Dr. Marcos, tudo bem? Verificando os repasses do mês, notei que o plantão do dia 28/09 no Hospital Santa Clara (R$ 2.100,00) ainda consta em aberto. Consegue me dar uma previsão? Obrigado!";
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <section id="demonstracao" className="py-16 bg-slate-900 text-white relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Veja na Prática
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Sua escala médica e seu dinheiro sem mistérios
          </h2>
          <p className="mt-3 text-slate-400 text-base">
            Interaja com a demonstração abaixo. É exatamente assim que você visualiza seus plantões no celular e no computador.
          </p>
        </div>

        {/* Mock Application Container */}
        <div className="mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-6 shadow-2xl">
          {/* Mock Top bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div className="flex items-center gap-3">
              <div className="size-3 rounded-full bg-rose-500/80" />
              <div className="size-3 rounded-full bg-amber-500/80" />
              <div className="size-3 rounded-full bg-emerald-500/80" />
              <span className="ml-2 text-xs font-mono text-slate-400">meuplantao.app/dashboard</span>
            </div>

            {/* Quick Metrics Bar */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 border border-slate-800">
                <span className="text-slate-400">Total Outubro:</span>
                <span className="font-bold text-white font-mono">R$ 5.550,00</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-emerald-950/60 px-2.5 py-1.5 border border-emerald-800/40 text-emerald-300">
                <span>Recebido:</span>
                <span className="font-bold font-mono">R$ 1.900,00</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-rose-950/60 px-2.5 py-1.5 border border-rose-800/40 text-rose-300">
                <span>Atrasado:</span>
                <span className="font-bold font-mono">R$ 2.100,00</span>
              </div>
            </div>
          </div>

          {/* Interactive Filter Pills */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-slate-400" />
              <span className="text-xs font-semibold text-slate-300">Filtrar por:</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveFilter("todos")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeFilter === "todos"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:text-white"
                }`}
              >
                Todos (3)
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("pendentes")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeFilter === "pendentes"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:text-white"
                }`}
              >
                A Receber (2)
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("atrasados")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeFilter === "atrasados"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:text-white"
                }`}
              >
                Atrasados (1)
              </button>
            </div>
          </div>

          {/* Shift Cards List */}
          <div className="mt-4 flex flex-col gap-3">
            {filteredShifts.map((shift) => (
              <div
                key={shift.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 transition-all hover:border-slate-700"
              >
                {/* Left shift info */}
                <div className="flex items-start gap-3.5">
                  <div className="mt-0.5 rounded-xl bg-slate-800 p-2.5 text-emerald-400 border border-slate-700/50">
                    <Hospital className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-100 text-sm sm:text-base">{shift.hospital}</h4>
                      <span className="text-xs text-slate-400">· {shift.setor}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span>{shift.data}</span>
                      <span>{shift.horario}</span>
                      <span>Resp: {shift.responsavel}</span>
                    </div>
                  </div>
                </div>

                {/* Right financial status & actions */}
                <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-slate-800/60 pt-3 sm:border-0 sm:pt-0">
                  <div className="text-left sm:text-right">
                    <span className="text-xs text-slate-400 block">Valor do Plantão</span>
                    <span className="font-mono text-base font-bold text-white">
                      R$ {shift.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {shift.status === "pago" && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-950/80 px-3 py-1.5 text-xs font-semibold text-emerald-300 border border-emerald-700/50">
                        <CheckCircle2 className="size-3.5" />
                        {shift.previsao}
                      </span>
                    )}
                    {shift.status === "pendente" && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950/80 px-3 py-1.5 text-xs font-semibold text-amber-300 border border-amber-700/50">
                        <Clock className="size-3.5" />
                        {shift.previsao}
                      </span>
                    )}
                    {shift.status === "atrasado" && (
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-950/80 px-3 py-1.5 text-xs font-semibold text-rose-300 border border-rose-700/50">
                          <AlertTriangle className="size-3.5" />
                          {shift.previsao}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyChargeMessage}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white underline decoration-slate-600 underline-offset-4"
                        >
                          <Copy className="size-3" />
                          {copied ? "Mensagem copiada!" : "Copiar cobrança WhatsApp"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Feedback banner */}
          <div className="mt-5 rounded-xl bg-slate-900/40 border border-slate-800 p-3 text-center text-xs text-slate-400">
            💡 <strong>Diferencial MeuPlantão:</strong> O status financeiro é sempre derivado das datas e pagamentos reais. Sem campos manuais que causam esquecimento.
          </div>
        </div>
      </div>
    </section>
  );
}
