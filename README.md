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

### Validação

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
