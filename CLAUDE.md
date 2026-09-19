# MeuPlantão — Claude Code Guidelines

## Invariantes e Regras Permanentes do Projeto

Consulte `AGENTS.md` para o contrato canônico de desenvolvimento. As três regras permanentes obrigatórias são:

### 1. Ciclo Git & Deploys via PR
- Criar sempre uma Issue no GitHub para qualquer tarefa (Correção, Melhoria ou Nova Função).
- Trabalhar sempre em branch dedicada (`feat/mai-XXX-...`, `fix/mai-XXX-...`).
- O worker DEVE obrigatoriamente realizar `git add .`, commit convencional (`feat:`, `fix:`), `git push` e `gh pr create --base main`.
- O PR DEVE mencionar a Issue na descrição (ex.: `Fixes #X`, `Closes #X`).
- **Exclusividade Humana:** O agente NUNCA faz merge do próprio PR nem dispara deploys diretos. A aprovação e o merge cabem exclusivamente ao Maick.

### 2. Motion Principles (`kylezantos/design-motion-principles`)
- Toda interface deve ter:
  - **Skeletons** proporcionais durante carregamento (zero tela em branco, zero CLS).
  - **Lazy Loading** para rotas, modais, gráficos e imagens secundárias.
  - **Smooth Animations** em todos os elementos:
    - Entrada (< 300ms, refinada e sem exagero)
    - Saída (< 200ms, limpa e ágil)
    - Carregamento (pulso/shimmer sutil)
    - Progresso (interpolação contínua e suave em barras e totalizadores)
  - Acessibilidade: respeitar obrigatoriamente `prefers-reduced-motion`.
  - Ergonomia: botões e áreas interativas com touch target mínimo de 44x44px.

### 3. Observabilidade, Qualidade de Código & Testes
- **Observabilidade:** Sentry (erros e exceções no client e server), Datadog/NewRelic/OpenTelemetry (APM, telemetria, web vitals), logs estruturados.
- **Qualidade & Lint:** Arch-contract (componentes não acessam DB direto; DAL em `src/lib/<modulo>/`), Biome (linter/formatter estrito), Commitlint (conventional commits), Knip (código morto), Stryker (mutation testing).
- **Testes:** Unitários e integração (Node native runner), E2E com Playwright em mobile e desktop, Codecov em CI.

### Padrões Técnicos
- Next.js 16 (App Router), TypeScript estrito, Tailwind CSS v4, shadcn/ui.
- Supabase Auth + Postgres com RLS e RPCs atômicos para obrigações e pagamentos.
- Validação pré-PR obrigatória: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
