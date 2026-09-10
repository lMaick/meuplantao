# Maick Dispatcher Control (MAI-66)

GUI Windows (Python 3.11 + Tkinter + PyInstaller) que controla com seguranca o dispatcher existente.
Autoridade unica: `ops/meuplantao-dispatcher/dispatcher.py`. Fluxo preservado: Linear -> dispatcher.py -> Orca.
A GUI nunca cria um segundo motor de dispatch: ela persiste `control-state.json`, consulta o Task Scheduler
real e dispara no maximo uma iteracao pelo mesmo `dispatcher.py`.

## Estados

- `ATIVO`: modo AUTO, scheduler habilitado, Orca acessivel, sem agente `working` ativo.
  Panes conectados com agente `done`/`idle` no prompt contam como ociosos, nao como
  EXECUTANDO (contrato `mai-68/agent-state-v1`).
- `PAUSADO`: novas buscas/dispatches suspensos; reconciliacao e monitoramento continuam.
- `EXECUTANDO`: existe pelo menos um agente `working` (ou equivalente) ativo.
- `ERRO`: config ausente/invalida, scheduler ausente/desabilitado/com erro, Orca inacessivel,
  falha de parse do scheduler, ou estado ausente/invalido (falha fechada).

## Contrato de estados do agente (MAI-68)

Mapeamento do estado estruturado do Orca (`worktree ps --json`, `agents[].state`):

- `working` -> `EXECUTANDO` (unico estado que acende EXECUTANDO na GUI).
- `waiting` -> `AGUARDANDO` (GUI mostra ATIVO/PAUSADO; detalhe em `agentStates`).
- `done`/`idle` -> `OCIOSO` (pane conectado no prompt nao e atividade).
- `failed` -> `FALHA` (nao conta como atividade; detalhe em `agentStates`).
- ausente/desconhecido -> `DESCONHECIDO` (contado em `agentStates.unknown`).

Fallback fail-closed: sem estado estruturado (Orca antigo, payload ausente ou
malformado, erro de leitura), o controle volta ao criterio legado conservador
(pane Codex conectado = EXECUTANDO); nunca presume ociosidade.

Vinculo unico issue -> worktree -> agente: multiplos panes Codex gravaveis no mesmo
worktree geram `duplicateAgents` + aviso na mensagem
("nenhum pane foi fechado automaticamente"); a GUI nunca fecha panes sozinha.

## Ownership do workflow

- Hermes planeja e audita; dispatcher reivindica e sincroniza o despacho;
  Orca executa o trabalho no worktree.
- GitHub e canonico para PR/checks; Linear e canonico para trabalho;
  merge permanece humano (a GUI nao faz merge nem deploy).

PAUSAR nunca mata agentes: nao chama close/delete/kill/stop. Com agente ativo a GUI informa
"Dispatcher pausado para novas tarefas - execucao atual nao foi interrompida."
O Task Scheduler permanece habilitado em PAUSED para ticks de reconciliacao/review.

## Fail-closed e bootstrap explicito

`control-state.json` ausente NAO cai em AUTO: `get_mode()` falha fechado e o dispatcher
aborta o tick sem despachar. Para colocar em operacao, rode o bootstrap intencional
(`control_state.bootstrap_auto()`), que so cria AUTO com config real valida e nunca
sobrescreve um estado existente.

## Pause coordenado com dispatcher.lock

A confirmacao do PAUSAR adquire o mesmo `dispatcher.lock` do tick: se um tick detem o
lock, o Pause aguarda ele terminar, persiste PAUSED e so entao confirma. Nenhum dispatch
comeca apos o acknowledgement; o trabalho em curso nunca e interrompido. Timeout sem
confirmacao = erro, sem persistir estado.

## Scheduler real

Nome da tarefa derivado da config `scheduler_task_name` (default `Hermes-MeuPlantao-Dispatcher`,
override permitido); a GUI apenas consulta (`/Query`), nunca cria/altera/remove a tarefa.
O parse usa o XML estrutural da tarefa (independente de idioma) para existencia/habilitado
mais extracao de horarios compativel com pt-BR e en-US; falha de parse = ERRO.

## Bundle PyInstaller

O exe one-file nao usa seu diretorio temporario como home: resolve via
`MEUPLANTAO_DISPATCHER_HOME` e/ou `MEUPLANTAO_DISPATCHER_CONFIG`, derivando
state/log/lock/dispatcher da config real. Sem essas variaveis, o bundle falha fechado.
O bundle exclui `dispatcher.py` e nunca inclui `config.toml`, state, logs, locks ou segredos.

## EXECUTAR AGORA sem travar a GUI

Roda `dispatcher.py --manual-once` em worker thread unico: o botao e desabilitado,
cliques concorrentes sao ignorados e o resultado/erro volta via `after`/queue,
reabilitando o botao.

## Arquivos

- `control_state.py`: `control-state.json` atomico (`AUTO|PAUSED`; `MANUAL` reservado e rejeitado).
- `dispatcher_home.py`: home/config/state/log/lock + lock compartilhado + validacao de config.
- `windows_scheduler.py`: leitura real via `schtasks /XML` + horarios (sem duplicar tarefa).
- `control_service.py`: pausa/retomada/run-once/status/logs com dependencias injetaveis.
- `control_app.py`: GUI fina Tkinter; relendo disco/scheduler a cada refresh.
- `dispatcher.py`: `--manual-once` ignora PAUSED so nesse processo, limita a 1 dispatch sob o lock existente;
  modo relido imediatamente antes de cada dispatch; telemetria sanitizada em `state.json.runtime` sob o lock.

## Uso

1. Copie `config.example.toml` para `config.toml` (ignorado pelo Git).
2. Bootstrap intencional do controle (uma vez, com config valida).
3. Rode a GUI: `python control_app.py` ou o exe local `dist/MaickDispatcherControl.exe`
   com `MEUPLANTAO_DISPATCHER_HOME` (ou `MEUPLANTAO_DISPATCHER_CONFIG`) apontando para o diretorio operacional.
4. ATIVAR/PAUSAR persiste o modo; EXECUTAR AGORA roda `dispatcher.py --manual-once`; ABRIR LOGS mostra as
   ultimas linhas de `dispatcher.log` e abre o arquivo.
5. Build local (ignorado pelo Git): `powershell -ExecutionPolicy Bypass -File build-control-app.ps1`.

## Guardrails

- Nao mexer na MAI-65, na copia operacional em AppData ou no Task Scheduler real; nao executar scheduler real.
- Nunca auto-merge; review stage preservado; `IgnoreNew`/PT5M/PT15M/lock/idempotencia intactos.
- Sem segredos no bundle/Git: config runtime, locks, state, logs, tokens e sessoes sao ignorados.

## Testes

- `python -m unittest discover -s ops/meuplantao-dispatcher -p "test_*.py" -v`
- Regressao MAI-68: `test_control_agent_states.py` (done conectado nao e EXECUTANDO;
  working e; waiting/idle/failed; payload ausente/malformado; multiplos panes).
- 21 testes legados preservados + novos: control_state (fail-closed/bootstrap), dispatcher_control,
  dispatcher_home (frozen), windows_scheduler (XML + pt-BR/en-US), control_service (orca-ERRO),
  control_pause_lock (concorrencia real), control_pause_evidence (agente antes/depois),
  control_app (thread), control_packaging (bundle sem engine/segredos),
  control_frozen_runner (exe nunca e interpretador Python).

## EXECUTAR AGORA no bundle frozen (fail-closed)

O exe PyInstaller nunca reusa `sys.executable` (o proprio `MaickDispatcherControl.exe`)
como interpretador de `dispatcher.py`. `control_service.build_dispatcher_command()` resolve,
a partir do home/config operacional (`MEUPLANTAO_DISPATCHER_HOME` ou
`MEUPLANTAO_DISPATCHER_CONFIG`), nesta ordem:

1. `run-dispatcher.cmd --manual-once` do home operacional (preferencial, via `cmd /c`);
2. `MEUPLANTAO_DISPATCHER_PYTHON` explicito + `dispatcher.py --manual-once`;
3. fora do frozen (dev): `sys.executable` + `dispatcher.py --manual-once`.

Sem wrapper e sem Python explicito, o frozen falha fechado: `run_once()` retorna
`ok=False` sem executar nada e sem fallback para o exe. Erro do wrapper/Python tambem
falha fechado (`ok=False`). `dispatcher.py` ausente no home falha fechado. Lock,
`--manual-once`, maximo 1 dispatch e safe skip estao preservados.
Smoke headless isolado: `MaickDispatcherControl.exe --run-once` (sem GUI, sem Linear,
Orca, AppData, scheduler ou dispatcher operacional).
