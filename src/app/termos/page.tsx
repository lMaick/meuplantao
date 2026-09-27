import { PublicPage, LegalSection } from "@/components/public-page";
import Link from "next/link";

export const metadata = {
  title: "Termos de Uso | MeuPlantão",
  description: "Conheça os termos de uso e condições gerais de utilização da plataforma MeuPlantão.",
};

export default function TermosPage() {
  return (
    <PublicPage
      title="Termos de Uso"
      intro="Diretrizes claras e transparentes para a utilização do MeuPlantão como sua central de gestão de escalas e repasses."
    >
      <LegalSection title="1. Escopo e caráter pessoal">
        <p>
          O MeuPlantão é uma plataforma destinada a médicos e profissionais de saúde para organização
          individual de suas escalas, locais de trabalho, contatos e controle financeiro de repasses de
          plantão.
        </p>
        <p>
          O acesso é pessoal e intransferível. Você é o único responsável por manter a
          confidencialidade das suas credenciais e por todas as operações realizadas na sua conta.
        </p>
      </LegalSection>

      <LegalSection title="2. Responsabilidade pelos registros e cálculos">
        <p>
          Você é integralmente responsável pela veracidade, acurácia e atualização dos dados
          inseridos na plataforma (datas, horas, locais, contratantes e valores previstos de repasse).
        </p>
        <p>
          Os saldos, totalizadores e alertas gerados pelo MeuPlantão refletem estritamente as
          informações fornecidas por você e servem como instrumento auxiliar de gestão pessoal. O
          sistema <strong>não substitui</strong> sua conferência formal junto aos hospitais, grupos
          escalistas, cooperativas ou demonstrativos contábeis oficiais.
        </p>
      </LegalSection>

      <LegalSection title="3. Limitações da ferramenta">
        <p>
          O MeuPlantão é disponibilizado como uma aplicação de produtividade em contínua evolução.
          Não garantimos disponibilidade ininterrupta ou isenção total de instabilidades decorrentes de
          serviços terceirizados ou conectividade de rede.
        </p>
        <p>
          A plataforma <strong>não realiza</strong> cobrança jurídica ou bancária ativa de terceiros,
          nem presta serviços de assessoria contábil, tributária, societária ou jurídica.
        </p>
      </LegalSection>

      <LegalSection title="4. Uso ético e seguro">
        <p>
          É terminantemente proibido tentar burlar sistemas de autenticação, explorar
          vulnerabilidades, interceptar tráfego alheio, realizar engenharia reversa ou submeter cargas
          que possam degradar a infraestrutura do serviço.
        </p>
        <p>
          O MeuPlantão reserva-se o direito de suspender acessos em caso de abuso ou risco à segurança
          coletiva dos usuários da plataforma.
        </p>
      </LegalSection>

      <LegalSection title="5. Atualizações dos termos e suporte">
        <p>
          Estes termos podem ser atualizados periodicamente para acompanhar novas funcionalidades ou
          ajustes regulatórios. A versão mais recente sempre estará publicada nesta página.
        </p>
        <p>
          Para dúvidas, sugestões ou suporte sobre estes termos, acesse a página de{" "}
          <Link href="/suporte" className="font-medium text-foreground underline underline-offset-4">
            Suporte e Feedback
          </Link>{" "}
          ou envie um e-mail para{" "}
          <a
            href="mailto:suporte@meuplantao.app"
            className="font-medium text-foreground underline underline-offset-4"
          >
            suporte@meuplantao.app
          </a>
          .
        </p>
      </LegalSection>
    </PublicPage>
  );
}
