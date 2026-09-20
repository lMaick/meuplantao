---
name: linear-orchestrator
description: "Use obrigatoriamente sempre que criar, estruturar ou delegar issues no Linear para o modelo dos 4 papéis (Maick + Gravity + Linear + Orca). Exige a estrutura canônica dos 5 blocos, especificação de skills, template de comentário e economia de tokens."
---

# Linear Orchestrator — Modelo dos 4 Papéis

Este skill é a **regra de operação permanente e obrigatória** para o Gravity (Gerente / Orquestrador) ao interagir com o Linear, Maick e Orca.

---

## 1. Os 4 Papéis

- **Maick (Dono):** Fornece o pedido, ativa o worker no Orca e aprova as entregas no Linear / PRs no GitHub.
- **Gravity (Gerente / Orquestrador):** Alinha os requisitos com o Maick, estrutura a issue no Linear em `Todo` com `Orca Ready` seguindo estritamente o template de 5 blocos. Gravity **NUNCA** dispara workers nem executa tarefas de produção sozinho no chat.
- **Linear (Mural Canônico):** Fonte única de verdade de briefing e status. Todas as entregas são avaliadas pelo Maick no Linear.
- **Orca (Braço Executor):** O Maick abre o Orca (**Tasks → Linear**), filtra por `Orca Ready`, seleciona a issue e cria o workspace para o worker executar o ciclo completo (código/arte + commit + push + PR + comentário no Linear).

---

## 2. Checklist Obrigatório Antes de Criar Qualquer Issue

Toda issue criada pelo Gravity no Linear DEVE cumprir:
1. **Projeto:** `MeuPlantao - Novo Fluxo` (`bd99b748-a38d-4355-bf1c-057ec9b1d398`).
2. **Status:** `Todo` (`5ae3889d-0a6f-4d2b-92ff-4b672ce366d8`).
3. **Labels:** `Orca Ready` + label do departamento (`Dev`, `Marketing`, `Bug`, `Feature`, `Infra`).
4. **Skills Obrigatórias:** Listadas explicitamente no cabeçalho da descrição (sempre incluir `orca-worker-protocol`).
5. **Os 5 Blocos Rígidos:** Preenchidos na íntegra sem omitir fronteiras, comandos Git ou template de comentário.
6. **Economia de Tokens:** Instrução no bloco 5 e na skill `orca-worker-protocol` exigindo que o worker responda no terminal apenas `Concluído: PR aberta e relatório postado no Linear.`

---

## 3. Estrutura Canônica do Briefing no Linear (Template de 5 Blocos)

```markdown
---
**Skills Obrigatórias:** `orca-worker-protocol, [ex: design-motion-principles, impeccable, frontend-developer]`
**Modelo Recomendado:** `[Codex / Claude Sonnet / GPT-4o]` (High Effort)
**Branch Base:** `main` ➔ `[feat|fix|docs]/[mai-XXX-slug]`
---

### 1. TAREFA & OBJETIVO
[Descrição numerada e precisa do que deve ser construído, corrigido ou gerado]

### 2. CONTEXTO & PADRÕES DO REPO
[Arquivos existentes, contratos, design system, paleta de cores ou regras clínicas envolvidas]

### 3. FRONTEIRAS & ARQUIVOS PERMITIDOS
- **Arquivos permitidos para alteração/criação:** `[lista explícita]`
- **NÃO TOCAR:** `[arquivos fora do escopo para evitar regressões]`

### 4. REGRAS & CRITÉRIOS DE ACEITE
- [Critério de negócio/clínico 1]
- [Critério de UX/Motion 2]
- Testes 100% verdes (`npm test && npm run lint && npx tsc --noEmit && npm run build`).
- Respeito estrito a `AGENTS.md`.

### 5. ENTREGA & TEMPLATE OBRIGATÓRIO (Git + Linear)
1. Executar no terminal do worktree:
   ```bash
   git add .
   git commit -m "[feat|fix|docs]([escopo]): [mensagem] (MAI-XXX)"
   git push -u origin [branch]
   gh pr create --base main --title "[feat|fix|docs]([escopo]): [mensagem] (MAI-XXX)" --body "Fixes #MAI-XXX"
   ```
2. **Comentário Obrigatório no Linear:** Publicar este template preenchido no card da issue:
   ```markdown
   🚀 **Entrega Concluída — MAI-XXX:**
   - **Pull Request:** https://github.com/lMaick/meuplantao/pull/XXX
   - **Branch:** [branch]
   - **Commit:** [SHA]
   - **O que foi feito:**
     - [Item 1]
     - [Item 2]
   - **Status dos Testes:** Todos os testes passando (npm test / typecheck / lint verdes).
   ```
3. **Economia de Tokens no Terminal Orca:** Ao terminar, responda no terminal APENAS uma linha:
   `Concluído: PR aberta e relatório postado no Linear.`
```

---

## 4. Pós-Merge Automático

- Para tarefas de **Marketing**: assim que o Maick aprovar e mergear o PR, o disparo/agendamento no Postiz (`ops/marketing/postiz-client.mjs`) deve ser acionado imediatamente.
- Para tarefas de **Desenvolvimento**: atualizar a issue no Linear para `Done` e sincar a `main` local.
