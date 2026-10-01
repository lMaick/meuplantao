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

1. **Issues no Linear para TODA Tarefa (fonte canônica):**
   - Crie obrigatoriamente uma issue no Linear (`MAI-XXX`) para qualquer tarefa antes de iniciar o trabalho: **Correção (Bugfix)**, **Melhoria (Enhancement)** ou **Nova Função (Feature)**.
   - A issue deve conter o objetivo, contexto clínico/operacional, escopo técnico e critérios de aceitação. O briefing canônico vive no card do Linear, não em Issue do GitHub.
2. **Ciclo Git Obrigatório por Tarefa:**
   - Trabalhe sempre em branch própria criada a partir de `main` (`feat/mai-XXX-...`, `fix/mai-XXX-...`).
   - O worker DEVE obrigatoriamente executar o ciclo Git completo: `git add .`, commit convencional (`feat:`, `fix:`, `mkt:`, `docs:`), `git push -u origin [branch]` e abrir o PR com `gh pr create --base main`.
3. **Gestão de Deploys via PR:**
   - Todo deploy em produção é gerenciado exclusivamente via Pull Request (PR) direcionado para `main`.
4. **Menção Obrigatória da Issue no PR:**
   - A descrição do PR **DEVE obrigatoriamente mencionar e conectar a issue do Linear correspondente** (identificador `MAI-XXX` + link do card). Quando existir Issue espelho no GitHub, use também a palavra-chave (`Fixes #123`, `Closes #123`, `Resolves #123` ou `Ref #123`).
   - O PR deve conter um sumário executivo do que foi feito, arquivos tocados, comandos de testes executados com status verde e notas de revisão.
5. **Revisão Humana e Merge Exclusivo:**
   - **NÃO faça merge do próprio PR**. A aprovação e o merge cabem exclusivamente ao humano responsável pelo projeto (Maick).

---

## 2. Padrão de Interface & Motion Principles (Regra Permanente 2)

Utilize a skill **Motion Principles** (`design-motion-principles`) via `.agents/skills-hub/skills/frontend/design-motion-principles/`. Toda interface do sistema DEVE cumprir:

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

O sistema deve manter permanentemente integrados os seguintes pilares. A lista
abaixo distingue **estado atual verificável** de **propostas não instaladas**
(auditoria MAI-142 — nada aqui pode exigir ferramenta sem
comando/dependência/CI correspondente):

1. **Observabilidade em Produção (estado atual):**
   - **Sentry SDK instalado (`@sentry/nextjs` em `package.json`):** captura via `src/lib/observability/index.ts` (`captureError`, logs estruturados sanitizados, `beforeSend` com redação de segredos/PII). Envio só ocorre com DSN configurado (`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`); sem DSN, apenas log JSON local. A origem de ingestão é incluída no `connect-src` da CSP somente quando o DSN está configurado (ver `src/lib/security/csp.ts`).
   - **Logs Estruturados:** toda mutação crítica (RPCs financeiras, checkout/sync/webhook Mercado Pago, rate limit de billing) emite log JSON com `route`, `rpc_name`, `alert_rule` e IDs sanitizados — nunca segredos, tokens, IP bruto ou corpo.
   - **Propostas (NÃO instaladas, NÃO exigir):** APM dedicado (Datadog / NewRelic / OpenTelemetry como serviço). O OpenTelemetry aparece apenas como dependência transitiva do Sentry (`package-lock.json`), sem instrumentação própria.
2. **Qualidade e Lint de Código (estado atual):**
   - **Arch-contract:** respeito absoluto à fronteira de camadas. Componentes de UI NUNCA fazem query direta solta. Toda interação com dados reside estritamente no DAL em `src/lib/<modulo>/` (ex.: assinatura em `src/lib/subscription/queries.ts` — `fetchMySubscription`, `getMySubscriptionRow`, `createSubscriptionChannel` — consumida por `src/lib/subscription/subscription-provider.tsx` sem `.from("subscriptions")` inline; migração concluída em MAI-143, PR #145).
   - **ESLint (`eslint-config-next`, `npm run lint` em `src/`):** linter e verificação vigentes no CI. Não há `biome.json`.
   - **TypeScript estrito (`strict: true`, `npx tsc --noEmit`):** obrigatório e verde no CI.
   - **Commits Convencionais manuais (`feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:` com `(MAI-XXX)`):** convenção exigida em revisão; sem hook/bot de Commitlint instalado (sem `commitlint.config.*`).
   - **Propostas (NÃO instaladas, NÃO exigir nem bloquear PR):** Biome, Commitlint automatizado, Knip, Stryker/mutation testing.
3. **Pirâmide de Testes (estado atual — `docs/TEST_INFRA.md`):**
   - **Testes Unitários & Integração (`npm test` → `node --test tests/*.test.mjs`):** validação matemática e idempotente das regras de negócio financeiro e RPCs atômicos (`save_shift_with_obligation`, `register_payment`, `process_mercadopago_subscription_payment`), CSP/HSTS, SEO seletivo, billing/rate-limit e invariantes de segurança.
   - **Testes Reais opt-in (Supabase local descartável, nunca produção):** `npm run test:real`, `npm run test:subscription-real`, `npm run test:subscription-reversal-real`, `npm run test:security-real` (+ `tests/*.real.sh`), `npm run db:smoke` e `npm run db:verify`. O CI executa esses jobs em Supabase local isolado (`ci.yml`: `real-e2e`, `subscription-payment-real-e2e`, `security-invariants-e2e`).
   - **Migrations & Schema Gate:** `supabase/migrations/` versionadas + `docs/DEVOPS_MIGRATIONS.md`; `prebuild` (`scripts/verify-production-schema.mjs`) é barreira fail-closed das 3 RPCs críticas; `deploy-production.yml` aplica migrations no merge em `main`.
   - **Propostas (NÃO instaladas, NÃO exigir):** Playwright E2E com browser, Codecov com gate de cobertura (sem step no CI).

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
- Assinatura/billing Mercado Pago server-side em `src/lib/mercadopago/` (sem SDK no browser; proxy same-origin `/api/mercadopago/*`, webhook `/api/webhooks/mercadopago`), estado em `src/lib/subscription/` + tabelas `subscriptions`/`subscription_checkouts`, rate limit em `src/lib/billing/rate-limit.ts`. Detalhes: `docs/operations/mercadopago-*.md`.
- SEO seletivo: landing (`/`), `/privacidade` e `/termos` indexáveis (`src/app/page.tsx`, `sitemap.ts`, `robots.ts` com `allow` restrito); todo o resto `noindex` (default em `src/app/layout.tsx` + `X-Robots-Tag` em `next.config.ts`).
- CSP via fonte única `src/lib/security/csp.ts`: `Content-Security-Policy-Report-Only` sempre (telemetria em `/api/csp-report`) + `Content-Security-Policy` efetiva somente sob `CSP_ENFORCE=true`. HSTS só no host de produção via HTTPS (`src/lib/security/hsts.ts` + middleware).
- CI 100% verde antes de abrir PR (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; jobs reais opt-in + `npm run db:smoke` quando houver mudança de schema/RPC).

## Skills de IA & Hub Central

O repositório consome o hub central de skills via Git Submodule em `.agents/skills-hub`:
- **42 Skills Universais** (hub): `.agents/skills-hub/skills/<setor>/<skill-nome>/` — inclui `impeccable`, `design-motion-principles` e 40+ outros. Nunca duplique essas skills localmente.
- **Skills Exclusivas do MeuPlantão** (locais em `.agents/skills/`): `content-calendar`, `linear-orchestrator`, `marketing-config`, `marketing-copywriter`, `marketing-designer`, `orca-worker-protocol`.
- **Regra:** Só crie uma skill em `.agents/skills/` se ela NÃO existir no hub. Cópias do hub são proibidas.
- **Atualização do hub**: `git submodule update --remote --merge`.
- **Checkout fresco:** o hub vem vazio até inicializar o submodule (`git submodule update --init --recursive`); sem isso, referências ao hub não são verificáveis localmente.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
