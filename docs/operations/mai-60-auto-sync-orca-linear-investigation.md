# MAI-60 - Estado do dispatcher Orca -> Linear

O dispatcher está implantado em `ops/meuplantao-dispatcher/`, separado do código
funcional do MeuPlantao. Paths, filtros e identidade da máquina vêm de config;
nenhuma credencial é versionada.

- MAI-60 foi despachada automaticamente.
- Exatamente um workspace e um agente Codex `gpt-5.6-luna` com raciocínio `low`.
- A segunda execução foi idempotente, sem duplicações.
- Linear está em `In Progress` com `Needs Review`.
- O fluxo nunca marca `Done` nem faz merge automático.

O template usa `InteractiveToken`, que é risco operacional por depender de sessão
interativa. A PR permanece aberta; merge depende de auditoria humana.
