# Maick Dispatcher Control (MAI-66)

GUI Windows (Python 3.11 + Tkinter + PyInstaller) que controla com seguranca o dispatcher existente.
Autoridade unica: `ops/meuplantao-dispatcher/dispatcher.py`. Fluxo preservado: Linear -> dispatcher.py -> Orca.
A GUI nunca cria um segundo motor de dispatch: ela persiste `control-state.json`, consulta o Task Scheduler
real e dispara no maximo uma iteracao pelo mesmo `dispatcher.py`.

## Estados

- `ATIVO`: modo AUTO, scheduler habilitado, Orca acessivel, sem agente `working` ativo.
  Panes conectados com agente `done` no prompt contam como ociosos, nao como
  EXECUTANDO, mas somente quando o estado estruturado e valido (ver contrato abaixo).
  Sem estado estruturado valido, pane Codex conectada conta como atividade
  (fallback legado; nunca vira ATIVO silenciosamente).
- `PAUSADO`: novas buscas/dispatches suspensos; reconciliacao e monitoramento continuam.
- `EXECUTANDO`: existe pelo menos um agente `working` do repo configurado ativo.
- `ERRO`: config ausente/invalida, scheduler ausente/desabilitado/com erro, Orca inacessivel,
  falha de parse do scheduler, ou descoberta impossivel (estado estruturado
  ausente/invalido E descoberta legada falhou: indeterminado fail-closed).

## Contrato de estados do agente (MAI-68)

Fonte primaria: estado estruturado do Orca (`worktree ps --json`, `agents[].state`,
contrato `mai-68/agent-state-v1`). Os unicos estados validos sao os declarados
pelo Orca (`AGENT_STATUS_STATES`: `working`, `blocked`, `waiting`, `done`):

- `working` -> `EXECUTANDO` (unico estado que acende EXECUTANDO na GUI).
- `blocked` -> `AGUARDANDO` (aguarda intervencao; nunca acende EXECUTANDO).
- `waiting` -> `AGUARDANDO` (GUI mostra ATIVO/PAUSADO; detalhe em `agentStates`).
- `done` -> `OCIOSO` (pane conectado no prompt nao e atividade).

`idle`/`failed` nao existem como `agents[].state` e sao tratados como estado
desconhecido: rejeitados na validacao estrita (fail-closed, ver abaixo).

Validade estrita: o payload so e aceito quando cada item e objeto com
`worktree`/`pane` como strings nao vazias, `agentType` valido (`codex`) e
`state` conhecido, e cada worktree traz `agents` como lista. Qualquer desvio
(worktree/pane ausente, vazio ou com tipo incorreto; `agentType` ausente,
vazio, com tipo incorreto ou desconhecido; state ausente, vazio ou
desconhecido; worktrees/agents/itens com forma invalida; payload parcialmente
malformado) invalida a LISTA INTEIRA: o controle aplica o criterio legado
conservador, nunca um "vazio valido".

## Envelope de completude e escopo (ps, worktree list, terminal list)

Toda resposta de descoberta precisa provar que esta completa: `truncated`
precisa ser booleano `false`, `totalCount` precisa ser inteiro nao-negativo
igual a quantidade de itens retornados, e `hostScope` precisa ser verificavel
(`hostIds` como lista nao vazia esperada e `omittedHostIds` vazio). Resposta
nao-objeto, `hostScope` ausente/incompleto, `truncated=true` ou lista parcial
(`totalCount` incoerente) significa descoberta incompleta: `worktree ps`
incompleto retorna `ERRO`/indeterminado fail-closed (jamais `ATIVO`, mesmo que
a descoberta legada esteja completa); `worktree list`/`terminal list`
incompleto propaga erro e, sem estado estruturado valido, tambem resulta em
`ERRO`/indeterminado. Zero valido (envelope completo + lista vazia) continua
distinguivel de descoberta incompleta.

## Escopo por repo (repoId canonico)

O `ps` e filtrado EXCLUSIVAMENTE por um repoId canonico: o controle resolve
primeiro exatamente um repoId para o `repo_name` configurado a partir de um
`worktree list` completo e verificado (envelope valido). Varios worktrees com
o mesmo repoId e mesmo repo sao esperados e deduplicados por repoId (nao e
ambiguidade). Sem correspondencia unica (nenhum repoId) ou com ambiguidade
(dois ou mais repoIds distintos), o controle falha fechado (`ERRO`/
indeterminado). Nunca se compara `repoId` com `repo_name`: um `ps` com
`repo='outro-repo'` e `repoId='meuplantao'` e descartado pelo filtro, e dois
repos chamados `meuplantao` com repoIds diferentes nao se misturam. `working`
Toda a lista e validada item a item ANTES de coletar repoIds: cada worktree
precisa ser objeto com `repo`, `repoId` e `path` como strings nao vazias e `repo`
EXATAMENTE igual ao `repo_name` configurado; entrada estrangeira (`repo` divergente)
ou identidade ausente/vazia/com tipo incorreto invalida a resposta inteira
(`ERRO`/indeterminado fail-closed) e nunca e descartada silenciosamente. Multiplos
worktrees legitimos com mesmo nome+ID continuam validos (deduplicacao por repoId).
de outro repo nunca altera o MeuPlantao. O `worktree list` e consultado tanto
pela descoberta legada quanto pela resolucao canonica; ambas as chamadas usam
envelopes verificados, sem duplicar chamadas inseguras.

Cada worktree do `ps` e validado ANTES de qualquer filtro: item nao-objeto,
`repo`/`repoId`/`path` ausente, vazio ou com tipo incorreto, ou `agents` que
nao seja lista significa descoberta incompleta (`ERRO`/indeterminado
fail-closed), nunca descarte silencioso virando `ATIVO`.

## Fallback legado / fail-closed (sem estado estruturado)

Sem estado estruturado utilizavel, vale uma unica regra com dois casos.
Quando o `ps` esta indisponivel (Orca antigo, erro de leitura, payload ausente
ou com estado desconhecido/rejeitado pelo parser), tenta-se o criterio legado:
se a descoberta legada funciona, ela decide (pane Codex conectada conta como
atividade: GUI `EXECUTANDO`; `pause()` informa que a execucao atual nao foi
interrompida; zero panes descobertos com sucesso decidem `ATIVO`). Se a
descoberta legada tambem falha, o estado e `ERRO`/indeterminado fail-closed
(nunca `ATIVO` nem `EXECUTANDO` presumido). Quando o `ps` responde mas o
envelope esta incompleto ou sem escopo verificavel (ver secao acima), o estado
e `ERRO`/indeterminado fail-closed e `pause()` propaga sem persistir, mesmo
que a descoberta legada esteja completa. O controle nunca presume ociosidade
sem prova: pane conectada jamais vira `ATIVO` silenciosamente nem recebe
mensagem de "nenhuma execucao" nesse caso.

`ERRO` fora disso: config ausente/invalida, scheduler ausente/desabilitado/
com erro, Orca inacessivel ou estado de disco ausente/invalido. Fallback
legado bem-sucedido nao e `ERRO`: com config/scheduler/Orca ok e descoberta
legada funcionando, a GUI mostra EXECUTANDO/ATIVO/PAUSADO normalmente.

Descoberta (`_list_agents_real`): os terminais sao agregados por worktree e o
path do worktree pai e autoritativo: substitui sempre qualquer `worktreePath`/
`worktreeId` trazido pelo terminal (sem `setdefault`), de modo que dois
terminais listados sob o mesmo pai agrupam juntos mesmo com paths vazios ou
divergentes, e dois pais diferentes nunca agrupam juntos. A deteccao de
multiplos panes agrupa por esse path: dois panes em worktrees diferentes nunca
geram falso `duplicateAgents`; dois no mesmo worktree geram aviso sem fechar
nada. Falha em `terminal list` para qualquer worktree (excecao ou forma
invalida) propaga erro em vez de virar zero silencioso: sem estado
estruturado valido, `get_status` retorna `ERRO`/indeterminado fail-closed
e `pause()` propaga sem persistir nem afirmar seguranca.

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
  working e; blocked/waiting nunca EXECUTANDO; idle/failed rejeitados; envelope
  truncado/hostScope/totalCount; escopo por repo; payload ausente/malformado;
  multiplos panes).
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
