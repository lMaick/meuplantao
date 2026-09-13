"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FaqItem {
  question: string;
  answer: string;
}

const faqs: FaqItem[] = [
  {
    question: "O MeuPlantão é gratuito para começar?",
    answer:
      "Sim! Você pode criar sua conta e organizar todos os seus plantões gratuitamente, sem precisar cadastrar cartão de crédito ou ter surpresas na hora de começar.",
  },
  {
    question: "Serve apenas para médicos ou outros profissionais de saúde?",
    answer:
      "O MeuPlantão atende perfeitamente médicos, enfermeiros, fisioterapeutas, biomédicos, dentistas e qualquer profissional autônomo que trabalhe com escalas e repasses em instituições de saúde.",
  },
  {
    question: "Como funciona o controle de pagamentos parciais e atrasos?",
    answer:
      "Ao cadastrar um plantão, você informa o valor e a data prevista de recebimento. Se o hospital repassar apenas uma parte, você registra o valor recebido e o saldo restante continua visível e contabilizado. Se a data prevista expirar e ainda houver saldo pendente, o app emite um alerta de atraso com o valor exato a ser cobrado.",
  },
  {
    question: "Preciso baixar da App Store ou Google Play?",
    answer:
      "Não é obrigatório! O MeuPlantão é um web app moderno (PWA) de alta velocidade. Basta abrir no navegador do seu smartphone e selecionar 'Adicionar à tela de início' para usá-lo com ícone direto no celular, ocupando quase zero memória.",
  },
  {
    question: "Meus dados financeiros e de plantões estão seguros?",
    answer:
      "Absolutamente. A arquitetura conta com banco de dados Postgres de nível bancário e políticas estritas de Row Level Security (RLS). Ninguém além de você pode visualizar ou alterar seus registros financeiros.",
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="perguntas" className="py-16 md:py-24 bg-slate-50 border-b border-slate-200/80">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Tire Suas Dúvidas
          </span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Perguntas Frequentes
          </h2>
          <p className="mt-3 text-slate-600 text-base">
            Tudo o que você precisa saber antes de organizar sua escala.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="rounded-2xl border border-border bg-card overflow-hidden transition-all shadow-xs"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(index)}
                  className="flex w-full items-center justify-between p-5 text-left font-bold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  aria-expanded={isOpen}
                >
                  <span className="text-base sm:text-lg">{faq.question}</span>
                  <ChevronDown
                      className={`size-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                       isOpen ? "rotate-180 text-foreground" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-1 text-sm sm:text-base text-muted-foreground leading-relaxed border-t border-border">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
