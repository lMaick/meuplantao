import type { Metadata } from "next";
import { DeleteAccountCard } from "@/components/account/delete-account-card";
import { LegalSection, PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Excluir conta | MeuPlantão",
  description: "Como excluir sua conta do MeuPlantão e os dados associados a ela.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function DeleteAccountPage() {
  return (
    <PublicPage
      title="Excluir conta"
      intro="Você pode excluir sua conta do MeuPlantão e os dados associados a ela quando quiser, sem precisar do aplicativo instalado."
    >
      <LegalSection title="O que é apagado">
        <p>
          Login, e-mail e perfil; plantões, locais e contatos; valores previstos, recebimentos e
          histórico; situação da assinatura e preferências de aviso. Tudo é apagado na hora.
        </p>
      </LegalSection>

      <LegalSection title="O que é mantido">
        <p>
          Se você pagou alguma assinatura, mantemos apenas o recibo: valor, data, período, situação e
          número do pagamento, sem seu nome nem e-mail. Ele serve para obrigações fiscais e
          contestações de pagamento.
        </p>
        <p>
          Cópias de segurança e registros técnicos podem guardar dados por um período limitado até
          serem substituídos.
        </p>
      </LegalSection>

      <section className="space-y-3 pt-2">
        <h2 className="text-lg font-semibold leading-6 text-foreground">Excluir agora</h2>
        <DeleteAccountCard />
      </section>
    </PublicPage>
  );
}
