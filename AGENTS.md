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