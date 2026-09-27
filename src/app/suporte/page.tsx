import { PublicPage, LegalSection } from "@/components/public-page";
import { SupportForm } from "@/components/support-form";

export const metadata = {
  title: "Suporte e Feedback | MeuPlantão",
  description: "Canal oficial de suporte, dúvidas e envio de sugestões do MeuPlantão.",
};

export default function SuportePage() {
  return (
    <PublicPage
      title="Suporte e Feedback"
      intro="Estamos aqui para ajudar. Envie sua dúvida, relate uma instabilidade ou compartilhe sugestões para aprimorarmos a sua experiência médica."
    >
      <LegalSection title="Orientações importantes de segurança">
        <p>
          Para sua segurança e conformidade, <strong>nunca envie</strong> senhas de acesso, chaves
          privadas de API, códigos de verificação recebidos por SMS/e-mail ou dados de cartões de
          crédito.
        </p>
        <p>
          Informe apenas o endereço de e-mail associado à sua conta e detalhes suficientes para que
          possamos reproduzir o cenário reportado.
        </p>
      </LegalSection>

      <section className="space-y-3 pt-2">
        <h2 className="text-lg font-semibold leading-6 text-foreground">
          Envie sua mensagem diretamente
        </h2>
        <p className="text-sm text-muted-foreground">
          Preencha os campos abaixo para abrir a mensagem pronta em seu aplicativo de e-mail:
        </p>
        <SupportForm />
      </section>

      <LegalSection title="Contato direto">
        <p>
          Se preferir, você também pode enviar uma mensagem diretamente através do seu cliente de
          correio para:{" "}
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
