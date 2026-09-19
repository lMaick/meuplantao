# MeuPlantão — Diretrizes do Projeto para Gemini & Antigravity

Este repositório adota as regras estritas e permanentes de engenharia e produto documentadas em `AGENTS.md`. Todo agente deve respeitar integralmente:

## 1. Ciclo de Vida de Tarefas & Gestão de Deploys
- **Issues no GitHub:** Crie obrigatoriamente uma Issue no GitHub para qualquer tarefa (Correção/Bugfix, Melhoria/Enhancement ou Nova Função/Feature) antes de iniciar o trabalho.
- **Branches:** Todo desenvolvimento ocorre em branch própria vinculada à Issue (`feat/issue-X`, `fix/issue-X`, etc.).
- **Deploy via PRs:** Todo deploy em produção é gerenciado via Pull Request para a branch `main`.
- **Vínculo Issue <-> PR:** A descrição do PR DEVE obrigatoriamente referenciar e encerrar a Issue correspondente (ex.: `Fixes #123`).
- **Aprovação Humana:** O agente nunca faz merge do próprio PR nem dispara deploys diretos.

## 2. Motion Principles & Requisitos de Interface
- **Skill:** Utilize a skill `design-motion-principles` (`kylezantos/design-motion-principles`) em `.agents/skills/design-motion-principles/`.
- **Skeleton:** Toda interface deve ter skeleton condizente com a tela em estados de carregamento (nunca tela em branco ou layout shift).
- **Lazy Loading:** Obrigatório para componentes secundários, modais, gráficos e imagens (`React.lazy`, `next/dynamic`, `loading="lazy"`).
- **Smooth Animation:** Animações suaves em todos os elementos:
  - Entrada (< 300ms, springs suaves/easings naturais)
  - Saída (< 200ms, rápida e limpa)
  - Carregamento (pulso/shimmer sutil)
  - Progresso (interpolação contínua e fluida sem pulos secos)
- **Acessibilidade:** Suporte obrigatório a `prefers-reduced-motion: reduce`.
- **Ergonomia Médica:** Touch targets mínimos de 44x44px e contraste mínimo de 4.5:1.

## 3. Observabilidade, Qualidade de Código & Testes
- **Observabilidade:** Sentry (erros e crashes no cliente e servidor), Datadog/NewRelic/OpenTelemetry (APM, métricas, tracing de banco) e logs estruturados.
- **Qualidade & Lint:** Arch-contract (respeito às camadas: componentes não chamam DB, DAL em `src/lib/<modulo>/`), Biome (linter e formatter), Commitlint (conventional commits), Knip (eliminação de código morto) e Stryker (mutation testing).
- **Testes:** Unitários e de integração para regras financeiras e RPCs, Playwright para testes End-to-End em mobile e desktop, e Codecov para validação de cobertura em PRs.

## 4. Orquestração Linear + Orca (O Modelo de 4 Papéis)
- **Maick (Dono):** Fornece os pedidos, ativa o worker no Orca e avalia as entregas no Linear / PRs no GitHub.
- **Gravity (Gerente / Orquestrador):** Alinha os requisitos, estrutura e cria a issue no Linear no estado `Todo` com o label `Orca Ready` usando o prompt de 5 blocos. Gravity **NUNCA** dispara workers nem executa tarefas de produção sozinho. **Todo briefing de issue DEVE exigir expressamente do worker:**
  1. `git add`, commit convencional (`feat:`, `fix:`, `docs:`, etc.), `git push` e `gh pr create` direcionado à `main`.
  2. Publicação obrigatória do **relatório completo estruturado como comentário no Linear** (PR, arquivos tocados, testes e resumo).
  3. **Economia de tokens no terminal Orca:** O worker deve responder no terminal apenas uma linha concisa (`Concluído: PR #X aberta e relatório postado no Linear`), sem despejar o relatório no terminal.
  4. Para tarefas de marketing: assim que o PR for aprovado e mergeado pelo Maick, o disparo/agendamento no Postiz deve ser executado imediatamente.
- **Linear (Mural Canônico):** Fonte única de verdade de briefing e status. Todas as entregas são avaliadas pelo Maick no Linear e no PR correspondente.
- **Orca (Braço Executor):** O Maick abre o Orca (**Tasks → Linear**), filtra por `Orca Ready`, seleciona a issue e cria o workspace para o worker executar o ciclo completo (código/arte + commit + push + PR + comentário no Linear).
