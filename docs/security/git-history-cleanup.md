# Limpeza coordenada de histórico Git — MAI-165

Este procedimento exige gate manual do coordenador. A aprovação da rotação
MAI-164 permite preparar a operação; **não** autoriza publicar histórico reescrito.
Merge e deploy permanecem sob responsabilidade do dono/coordenador autorizado.

## Preparação e gates

1. Registrar a revogação aprovada com fingerprint e status HTTP, sem token. Pausar
   pushes/merges e automações durante a janela; concluir ou fechar PRs em aberto
   conforme decisão do dono. Um push durante o inventário invalida os OIDs.
2. Usar diretório privado fora dos worktrees e de pastas sincronizadas/publicadas.
   No Windows, remover herança de ACL e conceder acesso apenas ao usuário operador
   e SYSTEM **antes** de clonar. Verificar a ACL efetiva. Nunca usar o `shared.git`
   do Orca para filter-repo, GC, remoção de refs ou reset.
3. Criar mirror remoto completo e salvar `ls-remote`/`for-each-ref` com OIDs de
   branches, tags e refs de PR. O backup permanece privado: ele contém o incidente.
   Testar `git fsck --full`, a leitura de objetos e o restore em cópia; impedir
   pushes acidentais do backup. Registrar plano de retenção/remoção privada.
4. Inventariar cada objeto alcançável (blobs, commits e tags), comparando o token
   somente em memória. Publicar contagens/caminhos/fingerprint, nunca o conteúdo.
   Incluir renomes, outras cópias e refs que alcançam os objetos afetados.
5. Clonar o backup com `--mirror --no-local` para simulação independente. Usar
   git-filter-repo >=2.47, com expressões de substituição em arquivo privado.
   A invocação usada na simulação desta operação é:

```text
git-filter-repo --sensitive-data-removal --no-fetch --invert-paths --path ops/marketing/postiz-config.json --replace-text PRIVATE_EXPRESSIONS --replace-message PRIVATE_EXPRESSIONS --prune-empty never --prune-degenerate never --preserve-commit-hashes --preserve-commit-encoding
```

`--preserve-commit-hashes` preserva referências textuais a SHAs nas mensagens,
não os OIDs dos commits reescritos. `--no-fetch` usa o inventário congelado;
exige comparar novamente o remoto antes da publicação. A remoção do caminho
elimina somente a configuração operacional que já deve permanecer local.

6. Validar o commit-map: nenhum commit desaparece, cada parent mapeado mantém
   a topologia, autoria/datas/mensagens permanecem iguais, cada árvore difere
   apenas no caminho privado removido. Comparar modos, OIDs de blobs e gitlinks
   de **todos** os commits; preservar `.gitmodules` e SHA de cada submodule.
   Assinaturas criptográficas de commits/tags não sobrevivem à reescrita; anotar
   essa limitação. Validar refs/objetos novamente, sem o caminho nem token.
7. Apresentar ao coordenador o mapa esperado→novo, escopo de refs, efeito nos PRs,
   preservação, recuperação e regras de proteção. Obter gate explícito. Se a PR
   de prevenção for mergeada depois do backup, refazer inventário e simulação a
   partir do novo main: nunca publicar o mirror antigo por cima de commits novos.
   Antes da publicação, repetir a prova privada de revogação: chave antiga HTTP
   401, nova e configuração operacional HTTP 200, somente metadados. Qualquer
   status divergente ou provedor indisponível interrompe a publicação.

## Publicação aprovada

Comparar **todas** as refs remotas com o inventário imediatamente antes da
operação; uma divergência, ref nova ou ausente interrompe a execução. Preparar
refspecs explícitos somente para branches/tags alteradas e lease com OID literal
por ref. Exemplo conceitual, a preencher pelo operador a partir do inventário:

```text
git push --atomic --force-with-lease=refs/heads/main:EXPECTED_OLD_OID PUBLIC_REMOTE NEW_OID:refs/heads/main
```

Não usar `push --mirror`, `--force`, leases implícitos ou excluir refs como atalho.
O push real deve incluir todas as branches/tags tratadas com leases explícitos
na mesma transação, preservando refs inalteradas. Verificar o suporte a atomic;
uma rejeição interrompe a operação e exige nova decisão.

Se rulesets bloquearem force push, apenas o dono/coordenador pode aprovar um
bypass limitado e sua duração. Salvar configuração antes e depois e restaurar
imediatamente; não deixar main sem PR/checks ou remover controles por conta própria.
O plano submetido ao gate deve identificar o operador e o bypass temporário
mínimo, com restauração do snapshot completo em `finally`, inclusive se o push
ou a validação falhar. Verificar a configuração efetiva após essa restauração.

## Validação e resíduos

Clonar novamente do remoto para diretório privado, capturar OIDs de branches/tags
e comparar com o mapa aprovado. Examinar todos os objetos alcançáveis pelas refs
normais e comprovar ausência do caminho/token. Rodar CI no **novo SHA de main**
e confirmar Secret Scanning, Push Protection e rulesets restaurados/ativos.
Após a PR de prevenção passar no CI, propor ao dono adicionar
`Secret scan (redacted)` aos checks obrigatórios do ruleset de main; aplicar
somente mediante aprovação e verificar o estado efetivo do check.

As refs `refs/pull/*` do GitHub são somente leitura; force push de branches não
as limpa. Registrar quantidade/IDs afetados, first-changed-commits e eventual LFS
órfão, sem tokens. O dono coordena GitHub Support para caches/refs internas e
proprietários de forks. Support pode não aceitar purge quando rotação já mitigou
o risco. Não afirmar remoção total: clones, forks, URLs antigas por SHA e refs de
PR são resíduos distintos das refs normais. Registrar evidência e pendências no
Linear pelo coordenador, nunca marcar concluído sem delimitar esse resultado.

## Recuperação de colaboradores e worktrees Orca

Preferir reclone com submodules inicializados depois da publicação. Antes disso,
parar agentes/automação e salvar trabalho não publicado em patch **privado e
escaneado**, além de arquivos ignorados, sem transportar `.git` ou refs antigas.
Recriar worktrees pelo Orca a partir do main limpo; o coordenador faz a migração
do repositório compartilhado somente após preservar o trabalho de cada dono.

Aplicar patches ou cherry-pick de commits próprios revisados numa branch nova.
Nunca fazer merge/push de uma branch antiga nem apenas `git pull` e `git push`:
isso pode reintroduzir os objetos removidos. Conferir base, submodules, diff,
scanner e testes antes de publicar. Registrar worktrees/clones já migrados e
bloquear pushes dos restantes. Manter backup privado sem remote de push para
investigação/recuperação; restaurar histórico contaminado ao remoto requer novo
gate, revogação comprovada e avaliação explícita do incidente.

Fontes oficiais:
[GitHub: remoção de dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository),
[git-filter-repo manual](https://github.com/newren/git-filter-repo/blob/main/Documentation/git-filter-repo.txt).
