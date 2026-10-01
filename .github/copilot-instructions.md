# GitHub Copilot Instructions — MeuPlantão

As diretrizes do projeto são governadas por `AGENTS.md`. Todos os modelos e sugestões de código devem seguir:

1. GESTÃO DE ISSUES E PRs:
- Toda tarefa (Correção, Melhoria ou Nova Função) deve ter uma issue no Linear (`MAI-XXX`, fonte canônica do briefing).
- Todo trabalho ocorre em branch própria (`feat/mai-XXX-...`, `fix/mai-XXX-...`) e é entregue via Pull Request para a branch `main` (`gh pr create --base main`).
- O PR deve referenciar a issue do Linear (`MAI-XXX` + link do card; mais `Fixes #123` quando houver Issue espelho no GitHub).
- Deploys são de responsabilidade do dono do projeto após merge do PR (agentes nunca fazem merge/deploy direto).

2. UI, MOTION & DESIGN PRINCIPLES:
- Baseado em `design-motion-principles` (skill do hub em `.agents/skills-hub/skills/frontend/design-motion-principles/`; checkout fresco exige `git submodule update --init --recursive`).
- Toda interface deve contar com:
  * Skeletons durante carregamento (prevenção total de CLS).
  * Lazy loading em rotas, modais, gráficos e imagens.
  * Smooth animations: Entrada (< 300ms), Saída (< 200ms), Carregamento (pulso/shimmer), Progresso (interpolação suave).
  * Acessibilidade: Obrigatório suporte a `prefers-reduced-motion`.
  * Touch targets de no mínimo 44x44px.

3. ENGENHARIA, QUALIDADE E TESTES (estado atual — ver `AGENTS.md` §3):
- Observabilidade: Sentry SDK (`@sentry/nextjs`, opt-in via DSN) + logs estruturados sanitizados (`src/lib/observability/`). Sem APM dedicado instalado (Datadog/NewRelic/OpenTelemetry como serviço são proposta, não requisito).
- Qualidade: Arch-contract (DAL em `src/lib/<modulo>/`, nunca queries soltas em componentes), ESLint (`eslint-config-next`), TypeScript estrito, Commits Convencionais manuais. Biome, Commitlint automatizado, Knip e Stryker NÃO instalados — não exigir.
- Testes: `npm test` offline (`node:test`) + E2E reais opt-in contra Supabase local (`test:real`, `test:subscription-real`, `db:smoke`). Playwright com browser e Codecov NÃO instalados — não exigir.
