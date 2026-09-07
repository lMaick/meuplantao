# MAI-60 - Investigação do auto-sync Orca -> Linear

Issue: [MAI-60](https://linear.app/maickagent/issue/MAI-60/corrigir-auto-sync-orca-linear-ao-iniciar-workspace-vinculado)

## Escopo

Esta investigação verifica se o auto-sync de um workspace Orca vinculado a uma
issue Linear é implementado no repositório MeuPlantao. A issue descreve uma
lacuna na infraestrutura Orca/Hermes, não uma regra de produto do MeuPlantao.

## Evidências

- A árvore do repositório não contém dispatcher, poller, integração com a API
  Linear, criação de workspace Orca ou tratamento de `Orca Ready`.
- O relatório da MAI-59 registra que a issue permaneceu em `Todo` com `Orca
  Ready` após a criação do workspace e exigiu intervenção manual.
- A própria investigação operacional da MAI-60 registra que `automations list`
  retornou vazio e que `ui.syncTaskStatusFromWorkspaceBoard` só sincroniza
  depois que um workspace existe; não é um dispatcher de criação.
- O workspace desta execução está corretamente vinculado à MAI-60 e a issue já
  está em `In Progress`, sem label `Orca Ready`.

## Conclusão

Não há alteração de produto ou de código do MeuPlantao capaz de corrigir a
causa raiz neste checkout. A implementação necessária pertence à infraestrutura
Orca/Hermes: configurar o dispatcher/poller e o callback de sincronização, com
retry idempotente e erro visível. Esta PR registra a evidência no repositório;
ela não declara o fluxo autônomo nem substitui o reteste externo solicitado na
MAI-60.

## Validação pendente

O reteste Hermes -> Linear -> Orca em uma issue de controle nova permanece
pendente de configuração/execução no ambiente Orca. Nenhum segredo ou
credencial é necessário para este registro.
