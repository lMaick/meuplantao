# MeuPlantao

Controle de plantões para profissionais autônomos da saúde (médicos, enfermeiros, fisioterapeutas e outros).

Registre onde trabalhou, plantões agendados/realizados, quanto deve receber, pagamentos totais e parciais, saldo restante e alertas de atraso. Mobile-first, seguro por usuário.

## Stack
- Next.js (App Router) + TypeScript estrito
- Tailwind CSS + shadcn/ui
- Supabase (Postgres + Auth + RLS)
- Sentry (`@sentry/nextjs`, opt-in via DSN) + logs estruturados sanitizados em `src/lib/observability/`
- Assinatura/billing Mercado Pago server-side (`src/lib/mercadopago/`, `src/lib/subscription/`, `src/lib/billing/`; sem SDK no browser)

## Rodando local
```bash
npm install
cp .env.example .env.local   # preencha as credenciais do Supabase
npm run dev
```

Veja `PRODUCT.md` para a visão de produto, `AGENTS.md` para as regras e contratos canônicos de desenvolvimento, e `CLAUDE.md` / `GEMINI.md` para as diretrizes específicas de agentes.

## Regras Permanentes de Engenharia & Negócio

Todo desenvolvimento neste repositório (humano ou por agentes de IA de qualquer modelo) segue obrigatoriamente três pilares contratuais:

1. **Ciclo de Tarefas, Issues e Deploys:**
    - **Issues no Linear Obrigatórias:** Crie uma issue no Linear (`MAI-XXX`, fonte canônica) para toda tarefa (Correção/Bugfix, Melhoria/Enhancement ou Nova Função/Feature) antes do início do código.
    - **Branches por Tarefa:** Todo trabalho é feito em branch dedicada a partir de `main` (`feat/mai-XXX-...`, `fix/mai-XXX-...`).
    - **Deploys via PR:** Todo deploy em produção é gerenciado exclusivamente via Pull Request direcionado para `main` (`gh pr create --base main`).
    - **Vínculo Issue ↔ PR:** A descrição do PR menciona obrigatoriamente a issue do Linear (`MAI-XXX` + link do card; mais `Fixes #X` quando houver Issue espelho no GitHub).
    - **Revisão Humana:** Agentes nunca realizam merge em `main` nem deploys diretos — aprovação e merge cabem ao dono (Maick).

2. **Padrão de Interface & Motion Principles (`design-motion-principles`, via submodule `.agents/skills-hub`):**
   - **Skeleton Screens Obrigatórios:** Toda tela, card, tabela ou painel métrico deve exibir skeleton proporcional no carregamento (zero tela em branco ou layout shift).
   - **Lazy Loading Universal:** Rotas secundárias, modais complexos, gráficos pesados e imagens (`React.lazy`, `next/dynamic`, `loading="lazy"`).
   - **Smooth Animation em Todos os Elementos:**
     - *Entrada:* 180ms a 300ms com springs suaves e easings naturais.
     - *Saída:* < 200ms, ágil e limpa.
     - *Carregamento:* Shimmer/pulso sutil e contínuo.
     - *Progresso:* Interpolação suave em barras e valores numéricos sem saltos secos.
   - **Ergonomia e Acessibilidade:** Touch targets mínimos de 44x44px, contraste mínimo 4.5:1 (WCAG AA) e suporte estrito a `prefers-reduced-motion: reduce`.

3. **Observabilidade, Qualidade de Código & Pirâmide de Testes (estado atual):**
    - **Observabilidade:** Sentry SDK (`@sentry/nextjs`, envio só com DSN) + logs estruturados sanitizados (`src/lib/observability/`). Sem APM dedicado instalado (Datadog/NewRelic/OpenTelemetry como serviço são proposta, não requisito).
    - **Qualidade & Lint:** Arch-contract (DAL estrita em `src/lib/<modulo>/` — ex. assinatura migrada para `src/lib/subscription/queries.ts` em MAI-143/PR #145), ESLint (`eslint-config-next`, `npm run lint` em `src/`), TypeScript estrito e Commits Convencionais manuais. Biome, Commitlint automatizado, Knip e Stryker NÃO estão instalados — não exigir nem bloquear PR por eles.
    - **Testes:** `npm test` offline (sem serviços externos — regras financeiras, RPCs atômicos, CSP/HSTS, SEO, billing) + testes reais opt-in, nunca produção, em duas categorias: Supabase local isolado e descartável (`test:real`, `test:subscription-real`, `test:subscription-reversal-real`, validadores `tests/*.real.sh`, `db:smoke` com `DATABASE_URL` local) e PostgreSQL 16 local isolado (`test:security-real`, via `pg` direto com guard fail-closed só-local — NÃO usa Supabase local). O schema gate (`prebuild`/`db:verify`) é bypass localmente, mas barreira fail-closed estrita em produção. Playwright com browser e Codecov NÃO estão instalados — não exigir.

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

### Google e GitHub OAuth

O login e o cadastro oferecem **Continuar com Google** e **Continuar com GitHub**. Ambos usam o mesmo callback seguro. O callback local
é `http://localhost:3000/auth/callback`; em produção, use a mesma rota sob a
origem pública do app (por exemplo, `https://seu-dominio.example/auth/callback`).

No Supabase, em **Authentication → Providers → Google**, habilite Google e
informe o Client ID e o Client Secret obtidos no Google Cloud Console. Em
**Authentication → URL Configuration**, adicione as origens do app e os
callbacks permitidos, incluindo a URL local e a URL de produção. No Google
Cloud Console, configure a URI de redirecionamento autorizada do provedor como
`https://<project-ref>.supabase.co/auth/v1/callback` (a URL exata aparece no
painel do Supabase), e cadastre as origens autorizadas do app. Nunca coloque
segredos no repositório, no `.env.local` versionado ou no navegador.

Para GitHub, habilite o provider correspondente no Supabase e configure no GitHub
OAuth App a mesma callback exibida pelo painel do Supabase. Os dois providers
retornam pela rota `/auth/callback`, que preserva apenas destinos internos via
`safeNext`.

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

O SEO é **seletivo** e atua em três camadas distintas:
- **Páginas públicas indexáveis e presentes no sitemap:** a landing (`/`), `/privacidade` e `/termos` (`src/app/page.tsx` e páginas com `index: true` + `canonical`, listadas em `sitemap.ts`).
- **`robots.ts` (regras de crawling):** permite crawling geral (`Allow: /`, mais as 3 rotas listadas) e bloqueia explicitamente `/api/` e `/auth/`.
- **Demais páginas privadas:** protegidas contra indexação por `noindex` padrão (`robots: { index: false }` em `src/app/layout.tsx`) + header `X-Robots-Tag: noindex, nofollow` para rotas privadas (`next.config.ts`).
A URL canônica vem de `getSiteUrl()` (`src/lib/config/site-url.ts`,
`NEXT_PUBLIC_SITE_URL` obrigatória em produção). Apenas `/robots.txt` foi
excluído do matcher de autenticação; isso não muda a proteção das páginas ou
dos dados.

Os headers desativam detecção de MIME, enquadramento por outras origens e acesso
a câmera, microfone e localização, e limitam o referenciador entre origens.
A CSP é emitida via `src/lib/security/csp.ts` (Report-Only sempre + efetiva
sob `CSP_ENFORCE=true`) e o HSTS (`Strict-Transport-Security: max-age=86400`)
é emitido pelo middleware somente no host de produção via HTTPS
(`meuplantao.pro`/`www.meuplantao.pro`), preservando HTTP local, previews e
scripts do Next.js. Detalhes em `docs/operations/hsts.md`.

### Assinatura e billing (Mercado Pago)

O browser nunca chama a API do Mercado Pago diretamente: o checkout passa por
proxy same-origin (`/api/mercadopago/*`, coberto por `connect-src 'self'` na
CSP) e redireciona via `init_point` top-level; o retorno do checkout volta ao
same-origin. Webhook (`/api/webhooks/mercadopago`), sync e verify rodam
server-side em `src/lib/mercadopago/` (timeouts/retries em `http.ts`, catálogo
canônico de planos em `payments.ts`), com estado em `src/lib/subscription/`
(DAL em `queries.ts`, tabelas `subscriptions`/`subscription_checkouts`) e rate
limit/cooldown em `src/lib/billing/rate-limit.ts`. A RPC crítica
`process_mercadopago_subscription_payment` (idempotente, fail-closed) é coberta
pelo schema gate do `prebuild`. Detalhes operacionais em
`docs/operations/mercadopago-webhook.md` e
`docs/operations/mercadopago-reversals.md`.

### Verificações locais

```bash
npm test
npm run lint
npm run build
npx tsc --noEmit
npm run db:smoke   # smoke test de schema e RPCs críticas
```

Os testes de configuração não usam credenciais reais nem acessam o banco.
Os testes reais são opt-in e nunca tocam produção, em duas categorias:
Supabase local isolado e descartável via Supabase CLI (`test:real`,
`test:subscription-real`, `test:subscription-reversal-real`) e PostgreSQL 16
local isolado via `pg` direto com guard fail-closed só-local
(`test:security-real` — não usa Supabase local). O schema gate
(`prebuild`/`db:verify`) é bypass em build local/CI-quality, mas barreira
fail-closed estrita em produção. Ver `tests/REAL-E2E.md` e
`docs/TEST_INFRA.md`.

### Migrations e Schema de Produção (DevOps)

O fluxo de aplicação de migrations, verificação pré-build na Vercel e o smoke test fail-closed de RPCs críticas (`save_shift_with_obligation`, `register_payment`, `process_mercadopago_subscription_payment`) estão documentados em detalhes em **[`docs/DEVOPS_MIGRATIONS.md`](docs/DEVOPS_MIGRATIONS.md)**.


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
