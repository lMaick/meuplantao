# MeuPlantao

Controle de plantões para profissionais autônomos da saúde (médicos, enfermeiros, fisioterapeutas e outros).

Registre onde trabalhou, plantões agendados/realizados, quanto deve receber, pagamentos totais e parciais, saldo restante e alertas de atraso. Mobile-first, seguro por usuário.

## Stack
- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (Postgres + Auth + RLS)

## Rodando local
```bash
npm install
cp .env.example .env.local   # preencha as credenciais do Supabase
npm run dev
```

Veja `PRODUCT.md` para a visão de produto e `AGENTS.md` para as regras de desenvolvimento.

### Configuração do Supabase

Use Node.js 22.18+ e `npm ci`. No PowerShell, copie o modelo com
`Copy-Item .env.example .env.local` (somente se `.env.local` ainda não existir).
O modelo contém campos vazios de propósito: não é uma configuração funcional.

No painel do seu projeto Supabase, abra **Connect** e copie a Project URL e a
chave pública para `.env.local`, na raiz do repositório:

- `NEXT_PUBLIC_SUPABASE_URL`: URL HTTP(S) do projeto.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave pública publishable ou a chave legada anon.
  O nome da variável é mantido por compatibilidade com o app.

Nunca use chaves secret/service_role nessas variáveis públicas. Não versione
`.env.local` nem compartilhe seus valores em commits, logs ou capturas de tela.
A configuração dos clientes segue a [documentação SSR do Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

Reinicie `npm run dev` após editar o ambiente. Para `npm start`, configure antes de
`npm run build` e gere um novo build quando os valores mudarem: as variáveis
`NEXT_PUBLIC_` são incorporadas ao JavaScript do navegador.

Sem configuração, com campos vazios, URL inválida ou os placeholders antigos,
as rotas retornam HTTP 503 com instruções, sem criar uma sessão ou liberar acesso
aos dados. Isso permite compilar sem credenciais, mas não usar o app sem Supabase.
Se a configuração estiver preenchida e o login falhar, confira se URL e chave
pertencem ao mesmo projeto ativo; a validação local não verifica credenciais remotamente.

### Metadados e estados do aplicativo

O aplicativo usa metadados MeuPlantao em português, viewport responsivo com zoom
permitido e tema claro. Os estados de carregamento, erro e página não encontrada
na raiz atendem às rotas públicas e protegidas; erros no layout têm uma tela
global independente de fontes e estilos externos. Os carregamentos e erros
tratados dentro dos componentes continuam usando suas próprias mensagens.

Como não há conteúdo público para busca, `robots.ts` bloqueia rastreamento e
as respostas usam `X-Robots-Tag: noindex, nofollow`, além dos metadados equivalentes.
Não há sitemap nem URL canônica inventada. Apenas `/robots.txt` foi excluído do
matcher de autenticação; isso não muda a proteção das páginas ou dos dados.

Os headers desativam detecção de MIME, enquadramento por outras origens e acesso
a câmera, microfone e localização, e limitam o referenciador entre origens.
Não há CSP restritiva, HSTS ou isolamento entre origens nesta configuração,
preservando HTTP local, scripts do Next.js e conexões/autenticação do Supabase.

### Verificações locais

```bash
npm test
npm run lint
npm run build
npx tsc --noEmit
```

Os testes de configuração não usam credenciais reais nem acessam o banco.

### Recuperação de sessão inválida (MAI-41)

O dashboard carrega plantões, pagamentos e locais em paralelo. Antes da correção,
`getAuthenticatedUserId()` substituía o erro de JWT por “Usuário não autenticado”,
e `throwOnError()` apenas lançava a mensagem das queries. Repetir o carregamento
mantinha a sessão inválida. O teste de regressão reproduziu esse fluxo na DAL real
com Supabase simulado: esperava limpeza e redirecionamento, mas não havia nenhum.

Agora, erros específicos de JWT acionam `signOut({ scope: "local" })` uma única vez
por documento, antes de navegar para `/login?reason=session-expired`. A tela exibe
uma orientação em português para entrar novamente e conferir o relógio se persistir.
O middleware permite essa tela mesmo se Auth ainda reconhecer o usuário, evitando
retorno automático ao dashboard. Falha na limpeza permite tentar novamente.
Erros de rede, credenciais de login, permissões e regras financeiras não acionam
a recuperação. Não há limpeza geral do armazenamento, alteração de dados ou migrations.

Os testes exercitam chamadas simultâneas, erros de queries/RPC, escopo local,
ordem da limpeza, erros não relacionados e proteção contra loops, sem banco real.

### E-mail transacional com remetente próprio

O SMTP padrão do Supabase é destinado a testes e restringe destinatários.
Para enviar confirmações com seu remetente:

1. Configure um provedor SMTP e verifique o domínio de envio. Publique os registros
   SPF, DKIM e DMARC indicados pelo provedor.
2. No painel Supabase, em **Authentication**, abra a configuração **SMTP** e ative
   **Custom SMTP**. Preencha host, porta, usuário e senha conforme o provedor.
3. Defina **Sender email** com um endereço autorizado do domínio e **Sender name**
   como `MeuPlantao`. Salve as credenciais somente no painel; nunca no código,
   variáveis `NEXT_PUBLIC_`, commits ou logs.
4. Revise **URL Configuration** (Site URL e destinos permitidos), os modelos de
   e-mail e os limites de envio. Mantenha a confirmação de e-mail habilitada.
5. Faça um cadastro de teste autorizado: confira remetente, entrega/spam, link de
   confirmação e login posterior. Consulte logs do Auth/provedor sem compartilhar
   credenciais ou links de confirmação.

Referência: [SMTP personalizado do Supabase](https://supabase.com/docs/guides/auth/auth-smtp).
Esta seção documenta a configuração; nenhuma alteração no serviço é feita pelo código.

### Diagnostico do e-mail de confirmacao (MAI-44)

Quando o cadastro aceita os dados mas o e-mail de confirmacao nao chega,
a causa costuma estar na configuracao do projeto Supabase, nao no codigo
do app. O fluxo de cadastro ja passa `emailRedirectTo` apontando para
`/login?next=...` da propria origem, e a UI mostra a mensagem orientando
sobre spam e reenvio. Antes de investigar o codigo, confira os pontos
abaixo no painel do projeto:

1. **SMTP padrao limitado.** O SMTP interno do Supabase so envia para o
   proprio dono do projeto e para destinatarios previamente autorizados.
   Para envio em producao, ative **Custom SMTP** (veja a secao anterior)
   ou adicione o destinatario de teste em **Authentication -> Users -> Add
   user**. Sem isso, o e-mail nunca sai para outros enderecos.
2. **Confirmacao de e-mail habilitada.** Em **Authentication -> Providers
   -> Email** verifique se **Confirm email** esta ligado. Quando esta
   desligado, `signUp` retorna uma sessao imediatamente e nenhum e-mail
   e enviado.
3. **Site URL e Redirect URLs.** Em **Authentication -> URL
   Configuration** o **Site URL** deve ser a origem publica do app
   (`http://localhost:3000` em desenvolvimento, o dominio real em
   producao). O link gerado no template usa esse valor; se estiver errado
   ou ausente, o link aponta para outro lugar ou falha na verificacao.
4. **Destinos permitidos.** Adicione as origens de callback a **Additional
   Redirect URLs**: `http://localhost:3000/auth/callback` e
   `http://localhost:3000/login` (mais a versao HTTPS em producao).
   Sem isso, o Supabase recusa o `redirectTo` enviado no `signUp`.
5. **Modelo de confirmacao.** Em **Authentication -> Email Templates ->
   Confirm signup** revise o corpo. Garanta que `{{ .ConfirmationURL }}`
   permanece no template. P?? de "Safe Links" do Microsoft 365 ou
   servicos de "email tracking" podem consumir o token antes do clique;
   desative-os ou troque o template por um link que receba o token via
   `verifyOtp` no app.
6. **Limite de envio.** O provedor pode aplicar rate limits por hora/dia.
   Aguarde a janela ou use outro endereco de teste. Consulte **Auth
   Logs** no painel para ver tentativas e respostas do provedor SMTP.
7. **Caixa de spam e aliases.** Verifique spam, lixo, "Promocoes" e aliases
   do destinatario. Dominios gratuitos (ex.: disposable mail) sao
   frequentemente bloqueados.

O codigo nao le nem registra credenciais SMTP, Google, ou chaves do
Supabase. Essas configuracoes vivem apenas no painel. Nenhum segredo
entra em commit, `.env.local` ou variavel `NEXT_PUBLIC_*`. Para inspecionar
o que o app envia, abra o DevTools do navegador e veja a aba **Network**
nas requisicoes a `/auth/v1/*` ou leia **Auth Logs** no Supabase.

### Login e cadastro com Google (MAI-44)

O app expoe um botao "Entrar com Google" em `/login` e "Cadastrar com
Google" em `/cadastro`. O fluxo segue a recomendacao do Supabase para
SSR: o cliente redireciona o navegador para o Google com `redirectTo`
apontando para `/auth/callback` da propria origem, e essa rota troca o
codigo de uso unico por uma sessao via `exchangeCodeForSession`.

Para ativar o provedor no projeto:

1. **Habilite o provider.** Em **Authentication -> Providers -> Google**
   ative o provider. Nao cole credenciais neste repositorio; elas ficam
   apenas no painel.
2. **Origens permitidas.** Em **Authentication -> URL Configuration**,
   confirme o **Site URL** e adicione `https://<seu-dominio>/auth/callback`
   em **Additional Redirect URLs** (incluindo `http://localhost:3000/auth/callback`
   para desenvolvimento). O Supabase so redireciona para destinos
   previamente aprovados.
3. **Vincular o Google Cloud.** Se for a primeira vez, o painel pedira o
   Client ID/Secret do projeto Google Cloud. Crie as credenciais em
   **Google Cloud Console -> APIs e Services -> Credentials -> OAuth
   client ID -> Web application** com o mesmo Site URL e o callback
   `/auth/callback`. O segredo fica somente no painel Supabase.
4. **Teste o fluxo.** Em desenvolvimento, abra `/cadastro`, clique em
   "Cadastrar com Google", autorize no Google e confira se o app cai em
   `/dashboard` (ou no `next` original) com a sessao ativa. Se o Google
   recusar o redirect, revise o **Authorized redirect URIs** no Google
   Cloud e o callback URL configurado no Supabase.
5. **Perfis existentes.** O trigger que cria linhas em `public.profiles`
   ao confirmar o e-mail nao cobre cadastros por OAuth. Para garantir o
   isolamento por `user_id`, a policy "profiles_insert_own" continua
   exigindo `auth.uid() = user_id`; o app cria o perfil no primeiro acesso
   autenticado, sem depender do trigger.

O codigo do app nao armazena Client ID/Secret do Google nem tokens de
acesso do provedor. Eles vivem no Supabase e no Google Cloud. Nenhum
valor real e versionado em `.env.example` ou `.env.local`.

Referencia: [Sign in with Google no Supabase SSR](https://supabase.com/docs/guides/auth/social-login/auth-google).
