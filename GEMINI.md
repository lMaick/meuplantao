# MeuPlantão — Diretrizes para Gemini & Antigravity

As regras canônicas estão em **[AGENTS.md](AGENTS.md)**. No fluxo principal, **Davi coordena, Bruno implementa, Nina corrige, Iara revisa e Téo testa**, usando a equipe do OpenMausBot. Orca e Gravity são opcionais.

- Davi registra e encaminha mudanças de código, usando Linear quando disponível. Cada editor possui branch e worktree exclusivas, faz commit/push e abre PR; o dono faz o merge.
- RLS, integridade dos pagamentos, segredos, gates de produção e arquitetura DAL são obrigatórios conforme `AGENTS.md`.
- Siga Motion Principles e execute os testes de qualidade (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`), mais os testes reais locais pertinentes.
- Skills universais residem em `.agents/skills-hub/`; skills específicas em `.agents/skills/`. Não duplique.
- `orca-worker-protocol` vale somente para workers executados no Orca, nunca como etapa compulsória da equipe.

Em caso de conflito, siga `AGENTS.md`.
