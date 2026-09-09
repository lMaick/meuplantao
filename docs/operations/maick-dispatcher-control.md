# Maick Dispatcher Control (MAI-66)

GUI Windows (Python 3.11 + Tkinter + PyInstaller) que controla com seguranca o dispatcher existente.
Autoridade unica: `ops/meuplantao-dispatcher/dispatcher.py`. Fluxo preservado: Linear -> dispatcher.py -> Orca.
A GUI nunca cria um segundo motor de dispatch: ela persiste `control-state.json`, consulta o Task Scheduler
real e dispara no maximo uma iteracao pelo mesmo `dispatcher.py`.

## Estados

- `ATIVO`: modo AUTO, scheduler habilitado, Orca acessivel, sem agentes ativos.
- `PAUSADO`: novas buscas/dispatches suspensos; reconciliacao e monitoramento continuam.
- `EXECUTANDO`: ha agente Codex ativo detectado.
- `ERRO`: config ausente/invalida, scheduler ausente/desabilitado/com erro, Orca inacessivel,
  falha de parse do scheduler, ou estado ausente/invalido (falha fechada).

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
- 21 testes legados preservados + novos: control_state (fail-closed/bootstrap), dispatcher_control,
  dispatcher_home (frozen), windows_scheduler (XML + pt-BR/en-US), control_service (orca-ERRO),
  control_pause_lock (concorrencia real), control_pause_evidence (agente antes/depois),
  control_app (thread), control_packaging (bundle sem engine/segredos).
