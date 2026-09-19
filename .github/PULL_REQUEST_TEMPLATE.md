## 📋 Resumo das Alterações

<!-- Forneça um resumo claro e conciso das alterações implementadas -->

### 🔗 Issue Vinculada (OBRIGATÓRIO)
<!-- Mencione obrigatoriamente a Issue correspondente para rastreabilidade e fechamento automático -->
Fixes #
<!-- ou Closes # / Resolves # / Ref # -->

---

## 🎨 Requisitos de UI & Motion Principles (kylezantos)
- [ ] **Skeletons:** Estados de carregamento implementados com skeletons fieis ao layout (sem telas brancas/CLS).
- [ ] **Lazy Loading:** Carregamento sob demanda aplicado em modais/rotas/componentes secundários.
- [ ] **Smooth Animations:** Animações calibradas de entrada (<300ms), saída (<200ms), carregamento e progresso.
- [ ] **Acessibilidade & Ergonomia:** `prefers-reduced-motion` respeitado e touch targets >= 44px.

---

## 🛡️ Observabilidade, Qualidade e Testes
- [ ] **Observabilidade:** Instrumentação (Sentry, OpenTelemetry/Datadog/NewRelic) e logs estruturados em pontos críticos.
- [ ] **Qualidade de Código:** Arch-contract respeitado (DAL isolado em `src/lib/<modulo>/`, sem queries soltas em componentes), Biome/Lint limpos.
- [ ] **Conventional Commits:** Commits seguem o padrão do Commitlint (`feat:`, `fix:`, `chore:`, etc.).
- [ ] **Testes Unitários & Integração:** `npm test` executado e 100% verde.
- [ ] **Testes E2E (Playwright):** Fluxos validados nos viewports mobile e desktop.
- [ ] **Build & Types:** `npx tsc --noEmit` e `npm run build` passando sem erros.

---

## 📸 Evidências / Demonstração
<!-- Adicione capturas de tela, gravações ou logs de testes se aplicável -->
