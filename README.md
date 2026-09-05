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
