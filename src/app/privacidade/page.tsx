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
          Utilizamos seus dados exclusivamente para: autenticar sua conta, exibir sua agenda de
          trabalho, calcular saldos e atrasos de repasse a partir dos valores lançados e emitir os
          alertas operacionais solicitados.
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

      <LegalSection title="4. Direitos do titular e exclusão de dados">
        <p>
          Em consonância com as boas práticas de proteção de dados (LGPD), você pode visualizar,
          editar ou excluir seus registros a qualquer momento através da interface do aplicativo.
        </p>
        <p>
          Caso deseje solicitar a exclusão definitiva da sua conta e de todos os registros associados,
          ou tirar dúvidas sobre privacidade, entre em contato através da nossa página de{" "}
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
