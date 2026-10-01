# MeuPlantão — Claude Code Guidelines

> As regras canônicas do projeto estão em **`AGENTS.md`**. Este arquivo é um ponteiro — leia `AGENTS.md` antes de qualquer tarefa.

## Resumo dos contratos obrigatórios

1. **Ciclo Git & Deploys via PR** — Issue no Linear (`MAI-XXX`) → branch dedicada → commit convencional → `git push` → `gh pr create --base main`. Nunca faça merge ou deploy direto.
2. **Motion Principles** — Toda interface: skeletons proporcionais, lazy loading, smooth animations (entrada < 300ms, saída < 200ms), `prefers-reduced-motion`, touch targets 44×44px.
3. **Observabilidade & Testes** — Sentry SDK + logs estruturados (`src/lib/observability/`), arch-contract (DAL em `src/lib/<modulo>/` — assinatura em `src/lib/subscription/queries.ts`, MAI-143), ESLint + `tsc` estrito, `npm test` offline + E2E reais opt-in contra Supabase local. Sem Biome/Playwright/Codecov/APM dedicado instalados — não exigir.
4. **Padrões técnicos** — Next.js App Router, TypeScript strict, Tailwind CSS v4, shadcn/ui, Supabase RLS.

Validação pré-PR: `npm test && npm run lint && npx tsc --noEmit && npm run build`.
