# GitHub Copilot Instructions — MeuPlantão

As diretrizes do projeto são governadas por `AGENTS.md`. Todos os modelos e sugestões de código devem seguir:

1. GESTÃO DE ISSUES E PRs:
- Toda tarefa (Correção, Melhoria ou Nova Função) deve ter uma Issue aberta no GitHub.
- Todo trabalho ocorre em branch própria e é entregue via Pull Request para a branch `main`.
- O PR deve referenciar a Issue em sua descrição (`Fixes #123`, `Closes #123`).
- Deploys são de responsabilidade do dono do projeto após merge do PR.

2. UI, MOTION & DESIGN PRINCIPLES:
- Baseado em `kylezantos/design-motion-principles` (skill disponível em `.agents/skills/design-motion-principles/`).
- Toda interface deve contar com:
  * Skeletons durante carregamento (prevenção total de CLS).
  * Lazy loading em rotas, modais, gráficos e imagens.
  * Smooth animations: Entrada (< 300ms), Saída (< 200ms), Carregamento (pulso/shimmer), Progresso (interpolação suave).
  * Acessibilidade: Obrigatório suporte a `prefers-reduced-motion`.
  * Touch targets de no mínimo 44x44px.

3. ENGENHARIA, QUALIDADE E TESTES:
- Observabilidade: Sentry, Datadog / NewRelic / OpenTelemetry, logs estruturados.
- Qualidade: Arch-contract (DAL em `src/lib/<modulo>/`, nunca queries soltas em componentes), Biome, Commitlint, Knip, Stryker.
- Testes: Pirâmide completa com Unitários, Integração, Playwright (E2E) e Codecov no CI.
