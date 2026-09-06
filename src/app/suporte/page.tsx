import { PublicPage } from "@/components/public-page";
import { SupportForm } from "@/components/support-form";

export default function SupportPage() { return <PublicPage title="Suporte e feedback" intro="Conte o que aconteceu ou sugira uma melhoria. O contato abre seu próprio aplicativo de e-mail."><p>Para manter o contato mínimo, não peça senha, chave de acesso, documento ou dados financeiros detalhados. Informe apenas o necessário para reproduzir o problema e, se quiser resposta, um endereço de retorno no seu aplicativo de e-mail.</p><SupportForm /><p className="text-sm text-muted-foreground">Se o formulário não abrir, envie uma mensagem diretamente para <a href="mailto:suporte@meuplantao.app" className="font-medium underline">suporte@meuplantao.app</a>.</p></PublicPage>; }
