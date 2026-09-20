# Findings & Decisions

## Requirements
- Usuário quer instalar Paperclip na lógica operacional do projeto MeuPlantão, não apenas testar uma instalação isolada.
- Preservar o checkout atual e não misturar o banco do Paperclip com Supabase/financeiro.

## Research Findings
- O Paperclip é um servidor Node.js com UI React e banco PostgreSQL embutido no modo local.
- O quickstart aceita projetos/workspaces Git e agentes Codex; a CLI documenta `test-drive`, `run`, empresas, tarefas e worktrees.
- O repositório MeuPlantão usa Next.js 16, TypeScript, Supabase e possui Dispatcher/Hermes em `ops/`.
- O checkout atual está na branch `codex/teste-novo-squema` com alterações não commitadas; não deve ser limpo ou sobrescrito.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Instalar em `C:\\Users\\Maick\\Documents\\paperclip` | Isolamento entre os repositórios e reversibilidade. |
| Integrar inicialmente por workspace/agentes, não copiando o código Paperclip para `src/` | O Paperclip é um control plane independente; a integração de domínio deve ser feita depois via adapter/API/Dispatcher. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
- https://github.com/paperclipai/paperclip
- https://github.com/paperclipai/paperclip/blob/master/doc/CLI.md
