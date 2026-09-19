---
name: orca-worker-protocol
description: "Protocolo obrigatório de finalização e entrega para todo worker do Orca no MeuPlantão. Exige ciclo Git completo, publicação de relatório estruturado diretamente no card do Linear e resposta de exatamente 1 linha no terminal para economia de tokens."
---

# Orca Worker Protocol — MeuPlantão

Este protocolo é **obrigatório e inegociável** para qualquer worker (agente de IA de qualquer modelo) executando tarefas em worktrees do Orca vinculados ao MeuPlantão.

---

## 1. Regra de Ouro: Onde Entregar e Onde Economizar Tokens

1. **O Linear é o Mural Canônico de Entrega:**
   - O relatório completo, detalhado e estruturado com a evidência do que foi feito DEVE ser publicado **exclusivamente como comentário no card da issue correspondente no Linear** (utilizando a tool de Linear / `save_comment` do Linear MCP).
   - **NUNCA** despeje o relatório de texto longo no terminal do Orca.

2. **O Terminal Orca é Estritamente Econômico (1 Linha):**
   - Para economizar tokens de contexto do usuário e manter a interface do Orca limpa, sua resposta final no terminal deve ser **EXATAMENTE uma linha concisa**:
     ```text
     Concluído: PR #<NUMERO_DA_PR> aberta e relatório postado no Linear.
     ```
   - Nenhuma explicação adicional, nenhum resumo de código, nenhuma repetição de diff no terminal.

---

## 2. Ciclo de Finalização Passo a Passo

### Passo 1: Validação & Gates de Qualidade
Antes de commitar, garanta que todos os testes e linters estejam 100% verdes:
```bash
# Para tarefas de Código/Frontend/Backend:
npm test && npm run lint && npx tsc --noEmit && npm run build

# Para tarefas de Marketing/Documentação:
# Verificar se as imagens estão salvas em docs/marketing/assets/ e legendas em ops/marketing/
```

### Passo 2: Ciclo de Git e Abertura de PR
1. Adicione os arquivos alterados e faça commit convencional (`feat:`, `fix:`, `mkt:`, `docs:`, etc.):
   ```bash
   git add .
   git commit -m "<tipo>(<escopo>): <mensagem descritiva> (MAI-XXX)"
   ```
2. Faça push para a branch da issue:
   ```bash
   git push origin <branch-da-tarefa>
   ```
3. Se a PR ainda não existir, crie-a direcionada para a `main`:
   ```bash
   gh pr create --base main --title "<tipo>(<escopo>): <mensagem descritiva> (MAI-XXX)" --body "Fixes #MAI-XXX"
   ```

### Passo 3: Publicação do Relatório Estruturado no Linear
Chame a tool do Linear (`save_comment` no MCP `linear-mcp-server`) passando o `issueId: "MAI-XXX"` com o seguinte template preenchido:

```markdown
🚀 **Entrega Concluída — MAI-XXX:**
- **Pull Request:** https://github.com/lMaick/meuplantao/pull/<NUMERO_DA_PR>
- **Branch:** <nome-da-branch>
- **Commit:** <SHA_DO_COMMIT>
- **O que foi feito:**
  - [Item 1: Descrição concisa da mudança técnica ou arte criada]
  - [Item 2: Correção ou arquivo entregue]
- **Status dos Testes:** Todos os testes passando (npm test / lint / tsc / build verdes).
```

### Passo 4: Encerramento no Terminal
Responda no chat/terminal apenas:
`Concluído: PR #<NUMERO_DA_PR> aberta e relatório postado no Linear.`
