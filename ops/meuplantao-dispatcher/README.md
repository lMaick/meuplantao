# MeuPlantao dispatcher

Dispatcher operacional Linear → Orca, isolado do código do produto. Requer
Windows, Python 3.11+, Orca aberto e autenticado via OAuth; o `gh` da GitHub CLI
é usado para detectar PRs.

## Configuração e validação

Copie `config.example.toml` para `config.toml` (ignorado pelo Git) e preencha:
`orca_dir`, `gh_executable` (vazio usa `gh` encontrado no PATH), `github_repo`,
`repo_name`, `repo_path`, `worktree_root`, `linear_workspace_id`, `team`,
`project`, `ready_label`, `review_label` e `max_dispatch_per_run`.
Não coloque tokens, sessões ou credenciais no arquivo.
`config.example.toml` nunca é usado automaticamente: sem `config.toml`, ou sem
`MEUPLANTAO_DISPATCHER_CONFIG` apontando para uma configuração válida, a execução
falha antes de acessar Orca, Linear, GitHub ou criar qualquer recurso.

Em clone limpo, rode `python test_dispatcher.py`. Na máquina configurada, rode
`run-dispatcher.cmd --dry-run` para validar conectividade e filtros sem criar
recursos; depois remova `--dry-run` para execução normal.
O wrapper define `MEUPLANTAO_DISPATCHER_CONFIG` para `%~dp0config.toml` somente
quando a variável está vazia; um override explícito é preservado.

## Task Scheduler

Substitua com segurança `__START_BOUNDARY__`, `__USER_OR_SID__` e
`__DISPATCHER_DIR__` no `task-scheduler.xml` por valores da máquina. Valide o XML
e instale com `schtasks /Create /TN MeuPlantao-Dispatcher /XML task-scheduler.xml
/F`. O template usa `IgnoreNew`, permite bateria, `StartWhenAvailable` e timeout
de cinco minutos. `InteractiveToken` exige usuário logado; é um risco conhecido.

## Retry e recuperação

O lock impede execuções concorrentes. Falhas antes da sincronização mantêm a
issue elegível (`Todo` + `Orca Ready`); falhas de comentário não desfazem um
dispatch confirmado. A reconciliação recupera um dispatch parcial sem criar
workspace/agente duplicado. `state.json`, `dispatcher.log`, lock, cache e
configuração local são ignorados pelo Git.
