# MeuPlantão — Diretrizes para Gemini & Antigravity

> As regras canônicas do projeto estão em **`AGENTS.md`**. Este arquivo é um ponteiro — leia `AGENTS.md` antes de qualquer tarefa.

## Resumo dos contratos obrigatórios

1. **Ciclo Git & Deploys via PR** — Issue no Linear (`MAI-XXX`) → branch dedicada → commit convencional → `git push` → `gh pr create --base main`. Nunca faça merge ou deploy direto.
2. **Motion Principles** — Toda interface: skeletons proporcionais, lazy loading, smooth animations (entrada < 300ms, saída < 200ms), `prefers-reduced-motion`, touch targets 44×44px.
3. **Observabilidade & Testes** — Sentry SDK + logs estruturados (`src/lib/observability/`), arch-contract (DAL em `src/lib/<modulo>/` — assinatura em `src/lib/subscription/queries.ts`, MAI-143), ESLint + `tsc` estrito, `npm test` offline + E2E reais opt-in contra Supabase local. Sem Biome/Playwright/Codecov/APM dedicado instalados — não exigir.
4. **Orquestração (4 Papéis)** — Maick (dono) → Gravity (orquestrador) → Linear (briefing canônico) → Orca (executor). Workers postam relatório completo no Linear e respondem no terminal em 1 linha.

## Skills disponíveis em `.agents/skills/`

Skills exclusivas do MeuPlantão (não presentes no hub universal):
- `content-calendar` — calendário editorial semanal
- `linear-orchestrator` — criação e delegação de issues no Linear
- `marketing-config` — branding, tom de voz e personas
- `marketing-copywriter` — copy para redes sociais e anúncios
- `marketing-designer` — criativos visuais para marketing
- `orca-worker-protocol` — protocolo de entrega do worker

Skills universais (via `.agents/skills-hub/`): `impeccable`, `design-motion-principles`, e 40+ outros.
