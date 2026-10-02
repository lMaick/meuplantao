import { Check, X } from "lucide-react";

export function PainVsSolution() {
  return (
    <section id="como-funciona" className="py-16 md:py-24 bg-background border-b border-border/80">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Comparativo Direto
          </span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Você trabalha pesado. Não deixe seu repasse se perder no caminho.
          </h2>
          <p className="mt-4 text-muted-foreground text-base sm:text-lg">
            A rotina em prontos-socorros e UPAs é exaustiva. Gerenciar sua remuneração não deveria ser um segundo trabalho.
          </p>
        </div>

        {/* Comparison Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {/* The Pain Card */}
          <div className="flex flex-col rounded-2xl border border-rose-200 bg-rose-50/40 p-6 sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-lg bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800 self-start">
              <span>Como você provavelmente faz hoje</span>
            </div>

            <h3 className="mt-4 text-xl font-bold text-foreground">
              O caos das planilhas e mensagens de WhatsApp
            </h3>

            <ul className="mt-6 flex flex-col gap-4 text-sm text-muted-foreground flex-1">
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-200 text-rose-700">
                  <X className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Planilhas desconfiguradas no celular:</strong> Tentar preencher fórmulas e células pequenas na tela do smartphone entre um paciente e outro.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-200 text-rose-700">
                  <X className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Repasses que caem a menos:</strong> O hospital desconta ou atrasa e você nem percebe porque não tem o valor exato previsto na mão.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-200 text-rose-700">
                  <X className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Escalas perdidas em grupos:</strong> Trocas de plantão, dobras e coberturas anotadas em guardanapo ou mensagens que somem.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-200 text-rose-700">
                  <X className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Constrangimento ao cobrar:</strong> Não lembrar a data certa do plantão e o nome do responsável ao pedir previsão do pagamento.
                </span>
              </li>
            </ul>
          </div>

          {/* The Solution Card */}
          <div className="flex flex-col rounded-2xl border-2 border-emerald-500/80 bg-emerald-50/30 p-6 sm:p-8 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900 self-start">
              <span>Com o MeuPlantão</span>
            </div>

            <h3 className="mt-4 text-xl font-bold text-foreground">
              Controle clínico com precisão cirúrgica
            </h3>

            <ul className="mt-6 flex flex-col gap-4 text-sm text-muted-foreground flex-1">
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Registro em segundos:</strong> Escolha o hospital, informe o valor e a data prevista. Interface rápida feita para usar com o polegar.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Alerta de atraso automático:</strong> Se a data prevista chegou e o repasse não caiu, o app destaca em vermelho para você cobrar sem demora.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Pagamentos parciais sob controle:</strong> Se o hospital pagou apenas metade da escala, o saldo remanescente continua em aberto automaticamente.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="size-3.5 stroke-[3]" />
                </div>
                <span>
                  <strong>Contatos e responsáveis organizados:</strong> Saiba quem é a pessoa de contato de cada escala para enviar mensagens objetivas.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
