# MeuPlantao — AGENTS.md

Regras e contratos permanentes para qualquer agente de IA de qualquer modelo trabalhando neste repositório.

## Invariantes não negociáveis

1. **Cada usuário só acessa os próprios dados.** Toda query/mutation passa pelo `auth.uid()` e pelas policies de RLS do Supabase. Nunca desative RLS. Nunca deixe SELECT sem filtro por usuário.
2. **Status financeiro é SEMPRE derivado dos dados reais.** Nunca salve um campo "status" manual. O saldo de um plantão = valor do plantão − soma dos pagamentos registrados. Atraso é calculado pela data prevista vs. data atual no fuso da aplicação (`America/Bahia`).
3. **Integridade financeira:** Alterar ou excluir um plantão que já possui pagamentos não pode criar inconsistência. Valide o saldo antes de qualquer mutação destrutiva. Proibido delete físico de pagamentos já registrados (use cancelamento lógico auditável).
4. **Nenhum segredo em código:** Chaves privadas, tokens ou URLs sensíveis pertencem unicamente ao `.env.local` e secrets do CI, nunca versionadas em código ou expostas em prompts.
5. **Deploy e Merge são do Dono:** O worker DEVE obrigatoriamente realizar commit, push e abrir o Pull Request (PR) com `gh pr create --base main`. É estritamente proibido fazer merge do próprio PR ou executar deploy direto em produção. A aprovação e o merge cabem exclusivamente ao humano (Maick).

---

## 1. Ciclo de Tarefas, Issues e Deploys (Regra Permanente 1)

1. **Issues no GitHub para TODA Tarefa:**
   - Crie obrigatoriamente uma Issue no GitHub para qualquer tarefa antes de iniciar o trabalho: **Correção (Bugfix)**, **Melhoria (Enhancement)** ou **Nova Função (Feature)**.
   - A Issue deve conter o objetivo, contexto clínico/operacional, escopo técnico e critérios de aceitação.
2. **Ciclo Git Obrigatório por Tarefa:**
   - Trabalhe sempre em branch própria criada a partir de `main` (`feat/mai-XXX-...`, `fix/mai-XXX-...`).
   - O worker DEVE obrigatoriamente executar o ciclo Git completo: `git add .`, commit convencional (`feat:`, `fix:`, `mkt:`), `git push -u origin [branch]` e abrir o PR com `gh pr create --base main`.
3. **Gestão de Deploys via PR:**
   - Todo deploy em produção é gerenciado exclusivamente via Pull Request (PR) direcionado para `main`.
4. **Menção Obrigatória da Issue no PR:**
   - A descrição do PR **DEVE obrigatoriamente mencionar e conectar a Issue correspondente** usando palavras-chave do GitHub (ex.: `Fixes #123`, `Closes #123`, `Resolves #123` ou `Ref #123`).
   - O PR deve conter um sumário executivo do que foi feito, arquivos tocados, comandos de testes executados com status verde e notas de revisão.
5. **Revisão Humana e Merge Exclusivo:**
   - **NÃO faça merge do próprio PR**. A aprovação e o merge cabem exclusivamente ao humano responsável pelo projeto (Maick).

---

## 2. Padrão de Interface & Motion Principles (Regra Permanente 2)

Utilize a skill **Motion Principles** (`kylezantos/design-motion-principles`) em `.agents/skills/design-motion-principles/`. Toda interface do sistema DEVE cumprir:

1. **Skeleton Screens Obrigatórios:**
   - Toda tela, card, tabela, lista ou painel métrico deve exibir skeleton proporcional e condizente com a estrutura final durante o carregamento.
   - Proibido deixar tela em branco, layout shift (CLS) ou telas com spinner isolado no vazio.
2. **Lazy Loading Universal:**
   - Aplique lazy loading em rotas secundárias, modais complexos, gráficos pesados e imagens (`React.lazy`, `next/dynamic`, `loading="lazy"`).
3. **Smooth Animation em Todos os Elementos:**
   - **Entrada (Enter):** Animação suave e refinada (fade-in, slide sutil) calibrada para produtividade médica (180ms a 300ms, springs suaves ou easings amortecidos, baseados em Emil Kowalski e Jakub Krehel).
   - **Saída (Exit):** Transição de saída rápida (< 200ms) e limpa, sem reter elementos fechados.
   - **Carregamento (Loading):** Shimmer ou pulso contínuo, suave e não intrusivo em skeletons e badges transitórios.
   - **Progresso (Progress):** Barras de progresso e atualizações numéricas de saldo devem interpolar com transições fluidas, sem saltos bruscos.
4. **Ergonomia e Mobile-First Clínico:**
   - Áreas de toque (touch targets) mínimas de 44x44px para botões, filtros, ícones de ação e campos.
   - Contraste mínimo de 4.5:1 (WCAG AA), paleta cirúrgica (OKLCH) sem gradientes artificiais de "AI slop".
5. **Acessibilidade Obrigatória:**
   - Suporte estrito a `prefers-reduced-motion: reduce`. Todo movimento espacial deve ser desabilitado ou substituído por opacidade imediata para usuários com sensibilidade vestibular.

---

## 3. Observabilidade, Qualidade de Código & Testes (Regra Permanente 3)

O sistema deve manter permanentemente integrados os seguintes pilares:

1. **Observabilidade em Produção:**
   - **Sentry:** Rastreamento contínuo de erros e exceções não tratadas (tanto client-side quanto server-side Next.js).
   - **Datadog / NewRelic / OpenTelemetry:** Instrumentação de APM (Application Performance Monitoring), métricas de runtime, Web Vitals e distributed tracing de chamadas ao Supabase.
   - **Logs Estruturados:** Toda mutação crítica e fluxo de autenticação deve emitir logs estruturados com metadados de contexto.
2. **Qualidade e Lint de Código:**
   - **Arch-contract:** Respeito absoluto à fronteira de camadas. Componentes de UI NUNCA fazem query direta solta. Toda interação com dados reside estritamente no DAL em `src/lib/<modulo>/`.
   - **Biome:** Linter e formatter ultra-rápido para garantir código consistente, tipagem rigorosa e regras de estilo.
   - **Commitlint:** Commits estritamente aderentes ao padrão Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`).
   - **Knip:** Detecção e eliminação sistemática de código morto, exports órfãos e dependências não utilizadas.
   - **Stryker:** Mutation testing para validação contínua da eficácia das asserções da suíte de testes.
3. **Pirâmide de Testes Completa:**
   - **Testes Unitários & Integração:** Validação matemática e idempotente das regras de negócio financeiro e RPCs atômicos (`save_shift_with_obligation`, `register_payment`).
   - **Testes End-to-End (Playwright):** Validação funcional dos fluxos do usuário em viewports mobile (360px a 430px) e desktop, cobrindo login, criação de plantão, recebimentos e transições de UI.
   - **Codecov:** Monitoramento contínuo de cobertura de código no CI em todos os PRs. Quedas de cobertura barram o pipeline.

---

## 4. Protocolo Obrigatório de Entrega do Worker no Orca (Regra Permanente 4)

Todo worker (agente de IA de qualquer modelo) atuando em worktrees do Orca DEVE utilizar e cumprir a skill `orca-worker-protocol`:
1. **Entrega no Linear:** O relatório completo (PR, branch, commit, testes e resumo) DEVE ser postado OBRIGATORIAMENTE no comentário do card da issue no Linear.
2. **Economia de Tokens no Terminal Orca:** Ao terminar, a resposta final no terminal DEVE ser estritamente de 1 linha: `Concluído: PR #<NUMERO> aberta e relatório postado no Linear.` É proibido despejar o relatório no terminal.
3. **Ciclo Git Completo:** `git add`, commit convencional (`feat:`, `fix:`, `mkt:`, `docs:`), `git push` e `gh pr create --base main`.

---

## 5. Padrões de Código e Arquitetura

- **Next.js App Router** + TypeScript estrito (`strict: true`).
- **Tailwind CSS + shadcn/ui** para UI.
- Acesso a dados em `src/lib/<modulo>/` como funções tipadas (DAL).
- Supabase client central em `src/lib/supabase/`.
- CI 100% verde antes de abrir PR (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`).

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
