# MeuPlantão — Claude Code Guidelines

As regras canônicas estão em **[AGENTS.md](AGENTS.md)**. O fluxo principal é o da equipe MeuPlantão Code (Davi, Bruno, Nina, Iara e Téo); Orca e Gravity não são intermediários obrigatórios.

- Davi planeja, delega e verifica. Cada worker editor usa branch/worktree exclusiva e abre PR para `main`; apenas o dono faz merge.
- Mudanças de código são registradas no Linear quando disponível, sem usar o Orca como passagem obrigatória.
- Preserve RLS, integridade financeira, segredos, arquitetura DAL, Motion Principles e gates de produção definidos em `AGENTS.md`.
- Valide código com `npm test && npm run lint && npx tsc --noEmit && npm run build`, além de testes reais isolados quando relevantes. Relate falhas com clareza.
- A skill `orca-worker-protocol` se aplica apenas quando este agente estiver trabalhando efetivamente no Orca.

Em conflito, os requisitos de segurança e engenharia do `AGENTS.md` prevalecem.
