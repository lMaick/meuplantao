import { PublicPage, LegalSection } from "@/components/public-page";
import Link from "next/link";

export const metadata = {
  title: "Política de Privacidade | MeuPlantão",
  description: "Entenda como o MeuPlantão protege suas informações e dados de plantões com isolamento e segurança.",
};

export default function PrivacidadePage() {
  return (
    <PublicPage
      title="Política de Privacidade"
      intro="Entenda como tratamos e protegemos seus dados de cadastro, escalas e repasses no MeuPlantão."
    >
      <LegalSection title="1. O que o MeuPlantão armazena">
        <p>
          Para viabilizar o funcionamento da plataforma e proteger sua conta, utilizamos seu e-mail e
          os identificadores de autenticação gerenciados via infraestrutura segura do Supabase.
        </p>
        <p>
          Dentro da sua central, você pode registrar plantões, locais de trabalho, contatos de
          escala/repasse, valores previstos e conciliações de pagamento. Todos esses registros ficam
          estritamente associados ao seu identificador individual de usuário.
        </p>
      </LegalSection>

      <LegalSection title="2. Como usamos as informações">
        <p>
          Utilizamos seus dados para a prestação das funcionalidades da plataforma: autenticar sua conta,
          exibir sua agenda de trabalho, calcular saldos e prazos de repasse a partir dos valores lançados
          e emitir os alertas operacionais configurados.
        </p>
        <p>
          Adicionalmente, dados técnicos e eventos de execução podem ser tratados para finalidades estritas
          de segurança, diagnóstico de erros, disponibilidade, prevenção de abuso e observabilidade do
          serviço (incluindo registros de telemetria e rastreamento sanitizado de falhas via ferramentas especializadas
          como o Sentry).
        </p>
        <p>
          O isolamento dos seus registros é garantido no banco de dados via políticas estritas de Row
          Level Security (RLS). O MeuPlantão <strong>não comercializa</strong> seus dados em hipótese
          alguma e não utiliza cookies ou rastreadores de terceiros para publicidade comportamental.
        </p>
      </LegalSection>

      <LegalSection title="3. O que você NÃO deve registrar">
        <p>
          O MeuPlantão é uma ferramenta de apoio à gestão operacional e financeira do próprio
          profissional. Registre apenas o estritamente necessário para o seu controle.
        </p>
        <p>
          <strong>Nunca insira</strong> informações médicas sigilosas de prontuários de pacientes,
          senhas de acesso a sistemas hospitalares, números de cartão de crédito ou dados sensíveis de
          terceiros sem autorização.
        </p>
      </LegalSection>

      <LegalSection title="4. Direitos do titular e integridade dos dados">
        <p>
          Você pode visualizar seus registros e, conforme a natureza do dado e as regras de
          integridade aplicáveis, editar, cancelar ou excluir informações pela interface. Solicitações
          relacionadas à exclusão da conta e dos dados associados podem ser feitas pelo suporte,
          observadas as necessidades legítimas de integridade, segurança e retenção.
        </p>
        <p>
          Para tirar dúvidas sobre privacidade ou exercer direitos sobre seus dados, entre em contato através da nossa página de{" "}
          <Link href="/suporte" className="font-medium text-foreground underline underline-offset-4">
            Suporte e Feedback
          </Link>{" "}
          ou pelo e-mail{" "}
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
