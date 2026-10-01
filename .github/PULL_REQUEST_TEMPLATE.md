## 📋 Resumo das Alterações

<!-- Forneça um resumo claro e conciso das alterações implementadas -->

### 🔗 Issue Vinculada (OBRIGATÓRIO)
<!-- Mencione obrigatoriamente a issue do Linear (MAI-XXX + link do card) para rastreabilidade; adicione Fixes #/Closes # quando houver Issue espelho no GitHub -->
MAI-XXX: <link do card no Linear>
Fixes #
<!-- ou Closes # / Resolves # / Ref # -->

---

## 🎨 Requisitos de UI & Motion Principles (skill `design-motion-principles` no hub)
- [ ] **Skeletons:** Estados de carregamento implementados com skeletons fieis ao layout (sem telas brancas/CLS).
- [ ] **Lazy Loading:** Carregamento sob demanda aplicado em modais/rotas/componentes secundários.
- [ ] **Smooth Animations:** Animações calibradas de entrada (<300ms), saída (<200ms), carregamento e progresso.
- [ ] **Acessibilidade & Ergonomia:** `prefers-reduced-motion` respeitado e touch targets >= 44px.

---

## 🛡️ Observabilidade, Qualidade e Testes
- [ ] **Observabilidade:** Sentry SDK / logs estruturados sanitizados em pontos críticos (sem segredos/PII; APM dedicado só se instalado).
- [ ] **Qualidade de Código:** Arch-contract respeitado (DAL isolado em `src/lib/<modulo>/`, sem queries soltas em componentes), ESLint + `tsc` estrito limpos (sem Biome/Knip/Stryker instalados — não exigir).
- [ ] **Conventional Commits:** Commits seguem o padrão manual (`feat:`, `fix:`, `docs:`, etc. com `(MAI-XXX)`; sem hook de Commitlint instalado).
- [ ] **Testes Unitários & Integração:** `npm test` executado e 100% verde (+ `db:smoke`/`db:verify` quando houver mudança de schema/RPC).
- [ ] **Testes Reais opt-in (nunca produção):** Supabase local descartável quando aplicável (`test:real`, `test:subscription-real`) e/ou Postgres 16 local (`test:security-real` — não usa Supabase local). Sem Playwright com browser nem Codecov instalados — não exigir.
- [ ] **Build & Types:** `npx tsc --noEmit` e `npm run build` passando sem erros.

---

## 📸 Evidências / Demonstração
<!-- Adicione capturas de tela, gravações ou logs de testes se aplicável -->
