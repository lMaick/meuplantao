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
e instale com `schtasks /Create /TN Hermes-MeuPlantao-Dispatcher /XML task-scheduler.xml
/F`. O template usa `IgnoreNew`, permite bateria, `StartWhenAvailable`, polling
a cada cinco minutos e timeout máximo de quinze minutos. `InteractiveToken`
exige usuário logado; é um risco conhecido.

## Retry e recuperação

O lock impede execuções concorrentes. Falhas antes da sincronização mantêm a
issue elegível (`Todo` + `Orca Ready`); falhas de comentário não desfazem um
dispatch confirmado. A reconciliação recupera um dispatch parcial sem criar
workspace/agente duplicado. `state.json`, `dispatcher.log`, lock, cache e
configuração local são ignorados pelo Git.

## Maick Dispatcher Control (MAI-66)

GUI Windows em Python 3.11 + Tkinter que controla o dispatcher sem criar um segundo motor. Detalhes em docs/operations/maick-dispatcher-control.md. Build local ignorado: powershell -ExecutionPolicy Bypass -File build-control-app.ps1 gera dist/MaickDispatcherControl.exe.

## MAI-69: Linear como barramento canonico

O dispatcher e um coordenador deterministico em Python, sem chamadas a LLM
para polling, decisao, claim, lock, deduplicacao, timeout ou notificacao.
`worker_id` apenas seleciona qual worker o Orca inicia; nao e modelo do dispatcher.

Responsabilidades por tick (sob lock, no maximo `max_dispatch_per_run`):

1. Consultar o Linear (projeto de operacao, estado `Todo`, label `Orca Ready`).
2. Claim deterministico com `dispatchId` persistido antes do side effect; o segundo
   tick nunca duplica worktree/agente para o mesmo `dispatchId`.
3. Confirmacao minima do side effect de criacao/vinculo; o caminho normal apos o
   dispatch aguarda estados/comentarios no Linear, sem polling de terminal para progresso.
4. Falha ambigua apos iniciar o side effect: sem retry automatico e sem segundo
   agente; se `dispatching` exceder `dispatch_timeout_seconds` sem confirmacao no
   Linear, marca `dispatch-timeout` sem redisparar.
5. `Needs Review`, `Blocked` e `Dispatch Timeout` sao detectados exclusivamente pelo
   Linear e disparam Hermes exatamente uma vez por fingerprint (issue + PR + SHA
   para review; issue + marcador para os demais; novo SHA reseta o fingerprint).
6. Evento Hermes minimo via `hermes-events.jsonl` (ignorado pelo Git): somente o
   identificador da issue e o tipo do evento; Hermes le o conteudo no Linear e faz
   verificacao rapida no GitHub, sem auditoria semantica automatica e sem polling.

Diagrama de estados (Linear + estado local):

    Todo + Orca Ready
      -> dispatching (claim + dispatchId)
      -> In Progress (dispatched)
      -> In Progress + Needs Review (PR/SHA; Hermes 1x por fingerprint)
      -> Blocked (Hermes 1x) | dispatch-timeout (Hermes 1x; sem redispatch)

Entrega fica em `In Progress + Needs Review`; nunca `Done` antes do merge confirmado.
Lock, filtros, maximo por tick, review gate e proibicao de auto-merge preservados.

Testes: `python -m unittest discover -s ops/meuplantao-dispatcher -p "test_*.py"`
(caminho feliz, erro reportado, timeout, crash ambiguo, deduplicacao Hermes,
novo SHA resetando fingerprint, sem policy/worker, sem LLM no polling).
