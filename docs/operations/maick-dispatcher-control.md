# Maick Dispatcher Control (MAI-66)

GUI Windows (Python 3.11 + Tkinter + PyInstaller) que controla com seguranca o dispatcher existente.
Autoridade unica: `ops/meuplantao-dispatcher/dispatcher.py`. Fluxo preservado: Linear -> dispatcher.py -> Orca.
A GUI nunca cria um segundo motor de dispatch: ela persiste `control-state.json`, consulta o Task Scheduler
real e dispara no maximo uma iteracao pelo mesmo `dispatcher.py`.

## Estados

- `ATIVO`: modo AUTO, scheduler habilitado, sem agentes ativos.
- `PAUSADO`: novas buscas/dispatches suspensos; reconciliacao e monitoramento continuam.
- `EXECUTANDO`: ha agente Codex ativo detectado.
- `ERRO`: config ausente/invalida, scheduler ausente/desabilitado/com erro, ou estado invalido (falha fechada).

PAUSAR nunca mata agentes: nao chama close/delete/kill/stop. Com agente ativo a GUI informa
"Dispatcher pausado para novas tarefas - execucao atual nao foi interrompida."
O Task Scheduler permanece habilitado em PAUSED para ticks de reconciliacao/review.

## Arquivos

- `control_state.py`: `control-state.json` atomico (`AUTO|PAUSED`; `MANUAL` reservado e rejeitado).
- `windows_scheduler.py`: leitura real via `schtasks` (sem duplicar tarefa).
- `control_service.py`: pausa/retomada/run-once/status/logs com dependencias injetaveis.
- `control_app.py`: GUI fina Tkinter; relendo disco/scheduler a cada refresh.
- `dispatcher.py`: `--manual-once` ignora PAUSED so nesse processo, limita a 1 dispatch sob o lock existente;
  modo relido imediatamente antes de cada dispatch; telemetria sanitizada em `state.json.runtime` sob o lock.

## Uso

1. Copie `config.example.toml` para `config.toml` (ignorado pelo Git).
2. Rode a GUI: `python control_app.py` ou o exe local `dist/MaickDispatcherControl.exe`.
3. ATIVAR/PAUSAR persiste o modo; EXECUTAR AGORA roda `dispatcher.py --manual-once`; ABRIR LOGS mostra as
   ultimas linhas de `dispatcher.log` e abre o arquivo.
4. Build local (ignorado pelo Git): `powershell -ExecutionPolicy Bypass -File build-control-app.ps1`.

## Guardrails

- Nao mexer na MAI-65, na copia operacional em AppData ou no Task Scheduler real; nao executar scheduler real.
- Nunca auto-merge; review stage preservado; `IgnoreNew`/PT5M/PT15M/lock/idempotencia intactos.
- Sem segredos no bundle/Git: config runtime, locks, state, logs, tokens e sessoes sao ignorados.

## Testes

- `python -m unittest discover -s ops/meuplantao-dispatcher -p "test_*.py" -v`
- 21 testes legados preservados + novos: control_state, dispatcher_control (pausa/manual-once/telemetria),
  windows_scheduler, control_service, control_app, control_packaging.
