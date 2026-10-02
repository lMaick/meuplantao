import {
  CalendarCheck,
  ClockAlert,
  Lock,
  MapPin,
  Smartphone,
  SplitSquareVertical,
} from "lucide-react";

const features = [
  {
    icon: SplitSquareVertical,
    title: "Status Derivado Real",
    description:
      "Evite status manual sujeito a esquecimento. O saldo é calculado a partir dos dados: valor do plantão menos a soma dos pagamentos parciais recebidos.",
  },
  {
    icon: ClockAlert,
    title: "Alertas de Atraso",
    description:
      "A data prevista de repasse chegou e o dinheiro não caiu? O MeuPlantão destaca os repasses em atraso para você cobrar sem deixar semanas passarem.",
  },
  {
    icon: MapPin,
    title: "Múltiplos Hospitais e UPAs",
    description:
      "Gerencie escalas em diferentes instituições de saúde. Associe cada local ao coordenador de escala e ao responsável pelo financeiro.",
  },
  {
    icon: CalendarCheck,
    title: "Agenda Integrada de Escalas",
    description:
      "Visualize plantões agendados e realizados em um calendário visual. Identifique dobras, períodos noturnos e seu tempo de descanso.",
  },
  {
    icon: Smartphone,
    title: "Ergonomia Mobile-First",
    description:
      "Criado pensando em quem usa o celular entre atendimentos com apenas uma mão. Áreas de toque confortáveis e contraste legível sob luz hospitalar.",
  },
  {
    icon: Lock,
    title: "Segurança e Isolamento RLS",
    description:
      "Banco de dados com isolamento por usuário (Row Level Security) e controles de acesso. Seus registros ficam associados apenas à sua conta.",
  },
];

export function FeaturesGrid() {
  return (
    <section id="recursos" className="py-16 md:py-24 bg-background border-b border-border/80">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Recursos Pensados para Você
          </span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Tudo o que você precisa, sem o peso do que você não usa.
          </h2>
          <p className="mt-4 text-muted-foreground text-base sm:text-lg">
            Software desenhado para ser direto, rápido e confiável na organização da sua remuneração de plantão.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="flex flex-col rounded-2xl border border-border/80 bg-muted/50 p-6 transition-all hover:bg-card hover:shadow-md hover:border-border"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs mb-5">
                  <Icon className="size-5.5 stroke-[2]" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed flex-1">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
