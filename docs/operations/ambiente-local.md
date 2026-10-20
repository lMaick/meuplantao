# Ambiente local isolado — MAI-173

Este procedimento prepara uma cópia independente para desenvolver e testar sem
usar usuários, credenciais ou banco de produção. O contrato dos testes e os jobs
do CI continuam em `docs/TEST_INFRA.md` e `.github/workflows/ci.yml`.

## Ferramentas verificadas

- Node **22.23.3**, npm **10.9.2** e dependências instaladas com `npm ci`.
- Supabase CLI **2.117.0**, mesma versão fixada no CI deste commit.
- Docker com PostgreSQL **16** para o teste de segurança e o stack próprio do
  Supabase CLI para os testes financeiros e de assinaturas.

O Node 22.14.0 não oferece `node:module.registerHooks`, usado pela suíte.
Confirmar `node -p "typeof require('node:module').registerHooks"`: deve retornar
`function`. Usar uma versão atualizada da linha 22, sem modificar os testes.

## Preparação

1. Criar uma branch/worktree a partir de `origin/main`; preservar a cópia original
   e quaisquer alterações não commitadas.
2. Executar `npm ci` no novo diretório. Não copiar `.env.local` de produção.
3. Confirmar acesso ao Docker. Nesta instalação, foi possível usar execução
   administrativa pontual sem mudar permissões do socket ou grupos permanentes.
4. Em um diretório sem `supabase/config.toml`, executar `supabase init`. Não usar
   `--force` sobre configuração existente sem examinar suas diferenças.
5. Criar uma rede Docker exclusiva antes de iniciar o Supabase:

   ```sh
   docker network create --driver bridge \
     --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
     meuplantao-local
   supabase start --network-id meuplantao-local \
     --exclude studio,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor,storage-api,imgproxy
   ```

   O conjunto reduzido oferece Auth, REST, Realtime, gateway e banco. Storage,
   email local e Edge Functions exigem ampliar o stack quando forem testados.
   Conferir os bindings com `docker ps`: as portas publicadas devem estar em
   `127.0.0.1`. Não reutilizar redes ou bancos de outros serviços.

6. Redirecionar `supabase status -o json` para um arquivo privado temporário
   (`umask 077`). Usar somente `API_URL` e `ANON_KEY` locais em `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   Definir `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3173` para desenvolvimento.
   Chaves de serviço permanecem somente no ambiente dos testes, nunca em
   variáveis `NEXT_PUBLIC_*`, logs ou artefatos do PR.

## Verificações

```sh
npm test
npm run lint
npx tsc --noEmit
NEXT_PUBLIC_SITE_URL=https://meuplantao.pro npm run build
```

O build de produção exige uma origem canônica HTTPS, inclusive quando compilado
localmente. A URL acima reproduz o CI e não publica o aplicativo. O servidor de
desenvolvimento usa a origem HTTP local configurada em `.env.local`.

Os comandos com banco exigem configuração **exclusivamente local**:

- `npm run test:security-real`: PostgreSQL 16 separado, com
  `SECURITY_REAL_DATABASE_URL` local e `SECURITY_REAL_REQUIRE_DB=1`. Esse teste
  cria/remove schemas e papéis; não apontar para o banco da aplicação nem de
  outro serviço. Usar container descartável e porta livre em loopback.
- `npm run db:smoke`: `DATABASE_URL`, URL e chaves do Supabase local.
- `npm run test:real`: `RUN_REAL_E2E=1`, URL/anon key locais e dois usuários
  fictícios confirmados na Auth local; fornecer `E2E_USER_A_*` e `E2E_USER_B_*`.
- `npm run test:subscription-real` e `npm run test:subscription-reversal-real`:
  `RUN_REAL_E2E=1`, `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` e
  `SUPABASE_SERVICE_ROLE_KEY` locais. São testes de RPCs; não fazem cobrança
  real no Mercado Pago.

Após as verificações, iniciar `npm run dev -- --hostname 127.0.0.1 --port 3173`.
Para parar o stack da cópia de teste, executar `supabase stop` nesse diretório;
remover somente recursos descartáveis identificados como pertencentes à tarefa.

## Evidência de 2026-10-20

Baseline: `45c592171666f2a09fc702b9e3da031925875617`.

| Verificação | Resultado |
| --- | --- |
| Offline, Node 22.23.3 | 873 testes: 872 passaram, 1 ignorado, 0 falhas |
| ESLint / TypeScript | Ambos passaram |
| Build Next.js | Passou com URL canônica HTTPS |
| PostgreSQL 16: segurança/RLS/grants | 1 teste real passou, sem skips |
| Schema/RPC smoke no Supabase local | Passou |
| Financeiro, RLS cruzada e concorrência | 1 teste real passou |
| Pagamentos de assinatura | 13 testes reais passaram |
| Estornos de assinatura | 6 testes reais passaram |
| Vercel | Projeto e 3 deploys consultados; todos em `READY` |
| Navegação visual local | Pendente: Browser recusou acesso ao serviço local |

O aviso de depreciação `middleware` → `proxy` continua presente no build.
Não houve migração de framework, mudança funcional, merge ou deploy.
A suíte offline e os testes HTTP/RPC não substituem inspeção visual: login,
cadastro de plantão e atualização da interface devem ser confirmados em uma
superfície de navegador autorizada a acessar este ambiente local.

Referência: [Supabase — desenvolvimento local](https://supabase.com/docs/guides/local-development).
