# MeuPlantao — AGENTS.md

Regras para qualquer agente de IA trabalhando neste repositório.

## Invariantes não negociáveis

1. **Cada usuário só acessa os próprios dados.** Toda query/mutation passa pelo `auth.uid()` e pelas policies de RLS do Supabase. Nunca desative RLS. Nunca deixe SELECT sem filtro por usuário.
2. **Status financeiro é SEMPRE derivado dos dados reais.** Nunca salve um campo "status" manual. O saldo de um plantão = valor do plantão − soma dos pagamentos registrados. Atraso é calculado pela data prevista vs. data atual.
3. **Integridade financeira:** alterar ou excluir um plantão que já possui pagamentos não pode criar inconsistência. Valide o saldo antes de qualquer mutação destrutiva.
4. **Nenhum segredo** em código, commit ou texto de prompt (chaves Supabase, tokens, URLs de serviço vão só no `.env.local`, nunca versionadas).
5. **Deploy é do dono.** Nunca rode deploy. Apenas códigos locais, testes e PRs.

## Padrões de código

- **Next.js App Router** + TypeScript estrito.
- **Tailwind CSS + shadcn/ui** para UI.
- Acesso a dados em `src/lib/<modulo>/` como funções tipadas (DAL). Componentes não fazem query direta solta.
- Supabase client central em `src/lib/supabase/`.

## Padrões de UI

- Mobile-first: a UI é pensada primeiro para o celular, depois ganha suporte desktop.
- Forte uso do Supabase Auth (login/cadastro/logout/middleware).
- Banco: Postgres via Supabase com RLS habilitado desde a primeira migration.

## Testes e qualidade

- Testes verdes antes de abrir PR.
- Lint limpo (`npm run lint`).
- CI vermelho nunca mergeia.

## Entregas

- Sempre em branch própria, PR para `main`.
- **NÃO faça merge do próprio PR** — deixe para revisão humana.
- Ao terminar, escreva um relatório curto: o que foi feito, arquivos tocados, testes rodados, e se algo ficou pendente.

## Skills de IA & Hub Central

O repositório consome o hub central de skills via Git Submodule em `.agents/skills-hub`:
- **42 Skills Universais**: localizadas em `.agents/skills-hub/skills/<setor>/<skill-nome>/` (frontend, backend, marketing, qa, product, devops).
- **Configurações Específicas do MeuPlantão**: localizadas em `.agents/skills/` (branding, personas, tom de voz clínico).
- **Atualização**: para sincronizar com a versão mais recente do hub central, execute `git submodule update --remote --merge`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
