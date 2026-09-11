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
(`hostIds` como lista nao vazia de IDs de host de execucao validos e `omittedHostIds` vazio). Resposta
nao-objeto, `hostScope` ausente/incompleto, `truncated=true` ou lista parcial
(`totalCount` incoerente) significa descoberta incompleta: `worktree ps`
incompleto retorna `ERRO`/indeterminado fail-closed (jamais `ATIVO`, mesmo que
a descoberta legada esteja completa); `worktree list`/`terminal list`
incompleto propaga erro e, sem estado estruturado valido, tambem resulta em
`ERRO`/indeterminado. Zero valido (envelope completo + lista vazia) continua
distinguivel de descoberta incompleta.
A chave de itens precisa estar presente com valor lista (`worktrees` no ps/list,
`terminals` no terminal list): chave ausente nunca vira zero valido. Cada `hostId`
precisa passar no parser de ExecutionHostId do Orca 1.4.198 (`local`, `ssh:<id>` ou
`runtime:<id>` com payload nao vazio e percent-encoding valido; `|` nao codificado,
prefixo vazio, percent-encoding invalido ou qualquer outra string invalidam o
envelope inteiro, incluindo `host-1`).

## Escopo por repo (repoId canonico via repo list)

O `ps` e filtrado EXCLUSIVAMENTE por um repoId canonico provado: o controle
resolve primeiro exatamente um repo cujo `displayName` seja EXATAMENTE igual ao
`repo_name` configurado a partir de `repo list --json` (`result.repos[]` com
`displayName`/`id` autoritativos; o contrato real nao tem `hostScope`).
Cada entrada precisa ser objeto com `displayName`/`id` como strings nao vazias;
zero ou multiplos matches falham fechado (`ERRO`/indeterminado). Lista vazia
de worktrees tambem falha fechado: ownership sem worktree provado nao decide
nada.

Todo `worktree list` e validado item a item ANTES de qualquer uso: cada worktree
precisa ser objeto com `repoId` e `path` como strings nao vazias, `repoId`
EXATAMENTE igual ao ID canonico do `repo list` e `repo`, quando declarado, string
nao vazia EXATAMENTE igual ao `repo_name` (o contrato real do `worktree list` no
Orca 1.4.198 omite `repo`; item sem `repo` mas com `repoId` canonico e caminho
legitimo continua valendo). Qualquer FOREIGN-ID invalida a resposta inteira,
mesmo com `repo` ausente; identidade ausente/vazia/com tipo incorreto ou item
nao-objeto tambem invalida tudo (`ERRO`/indeterminado fail-closed). Nunca se
compara `repoId` com `repo_name`. Multiplos worktrees legitimos com mesmo nome
e mesmo ID canonico sao esperados (nao e ambiguidade).

Cada worktree do `ps` e validado ANTES de qualquer filtro (item nao-objeto,
`repo`/`repoId`/`path` ausente, vazio ou com tipo incorreto, ou `agents` que nao
seja lista = `ERRO`/indeterminado); depois da validacao, pertencem ao escopo
somente os itens com `repoId` igual ao canonico E `repo` igual ao `repo_name`.
`working` de outro repo nunca altera o MeuPlantao. O `worktree list` e consultado
tanto pela descoberta legada quanto pela resolucao canonica; ambas as chamadas
usam envelopes verificados, sem duplicar chamadas inseguras.

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

- Hermes coordena e consolida evidências operacionais; a auditoria técnica externa é realizada separadamente.
- Dispatcher reivindica e sincroniza o despacho; Orca executa o trabalho no worktree.
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
  truncado/hostScope/totalCount; escopo por repo via repo list canonico; payload ausente/malformado;
  multiplos panes; hostIds estritos (ExecutionHostId); chave de itens ausente; fallback legado validado).
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

## MAI-69: dispatcher como coordenacao orientada pelo Linear

O dispatcher (`ops/meuplantao-dispatcher/dispatcher.py`) e um coordenador
deterministico em Python. Nao chama LLM para polling, decisao, claim, lock,
deduplicacao, timeout ou notificacao. `worker_id` apenas seleciona qual worker
o Orca inicia; nao e modelo do dispatcher.

### Linear como barramento canonico

- Entrada: projeto de operacao, estado `Todo`, label `Orca Ready` (filtros exatos;
  consulta truncada falha fechado).
- Claim deterministico antes do side effect com `dispatchId` estavel
  (`uuid5(dispatch:<ISSUE>)`) persistido em `state.json`; o segundo tick nunca
  duplica worktree/agente para o mesmo `dispatchId`.
- Confirmacao minima do side effect de criacao/vinculo no dispatch; o caminho
  normal apos o dispatch aguarda estados/comentarios no Linear, sem polling de
  terminal para progresso ou conclusao.
- Falha ambigua (excecao apos iniciar criacao/recuperacao, antes da confirmacao
  no Linear): status local volta a `dispatching` com erro sanitizado, sem retry
  automatico e sem segundo agente. Falha antes do side effect (ex.: preflight sem
  policy/worker valido) mantem `error` com zero criacao e erro sanitizado.
- `dispatching` sem confirmacao no Linear alem de `dispatch_timeout_seconds`
  (default 900, override em `config.toml`) vira `dispatch-timeout`, sem redispatch.
- Linear-first: `poll_linear_outcomes` abre cada tick (antes de status Orca,
  reconcile, monitor e dispatch), de modo que resultado/erro ja publicado avancam
  mesmo com preflight invalido ou sem terminal; `reconcile_dispatches` fica so como
  recuperacao excepcional e `monitor_deliveries` segue fail-closed no preflight.
- Conclusao/erro/review detectados exclusivamente por comentarios/estados do Linear:
  o worker publica `MeuPlantao-Report: delivery pr=<PR-URL> sha=<SHA> tests=<resumo>`
  ou `MeuPlantao-Report: error|blocked <texto>` sanitizado; o dispatcher verifica a
  PR reportada via `gh` (aberta, base `main`, SHA igual) e nunca descobre entrega
  pelo GitHub sozinho (`monitor_deliveries` exige report Linear antes de qualquer
  chamada `gh`). `Blocked` por estado/label no Linear; nunca por terminal Orca.
- `Dispatch Timeout` persistido no Linear (label `timeout_label`, default
  `Dispatch Timeout`, + comentario) e no estado local, com estagios retentaveis.
- Erros publicados passam por `sanitize_for_linear` (tokens, chaves, credenciais).
- Entrega fica em `In Progress + Needs Review`; nunca `Done` antes do merge;
  auditorias e correcoes vivem em comentarios no Linear.

### Hermes: evento duravel + gate de consumo + atuador do operador

- Acionamento em duas partes implementadas nesta PR, sem LLM no dispatcher:
  (a) evento duravel como comentario Linear minimo (somente issue + tipo),
  deduplicado por fingerprint gravado so apos post confirmado, com retry no
  proximo tick em vez de perda (idempotente e crash-safe);
  (b) gate de consumo `run-dispatcher.cmd --hermes-precheck` (somente leitura,
  sem lock) que lista eventos emitidos ainda sem `MeuPlantao-Ack: <fingerprint>`
  (exit 0 = pendente, exit 1 = quieto; Linear inacessivel e fail-closed pendente).
  O Hermes, ao consumir, posta `MeuPlantao-Ack: <fingerprint>` na issue.
  (c) Atuador: automacao Orca do operador via contrato suportado
  (`orca automations create --trigger <cron> --precheck "<DISPATCHER_DIR>\run-dispatcher.cmd
  --hermes-precheck" --prompt "<prompt Hermes com ack>" --provider <agent>`;
  exit 0 continua, demais registram skipped). A criacao NAO foi executada nesta PR
  (AppData/rollout do dono; vedada pela auditoria) e fica como unico passo pendente
  do operador, com comando exato acima.

- Persistido apenas nos estados configurados (`needs-review`, `blocked`,
  `dispatch-timeout`), nunca para polling periodico.
- Evento: comentario Linear com o prompt minimo
  `Leia a MAI-N no Linear e processe conforme o fluxo padrao. (evento=<tipo>)`.
  Contrato verificado: Hermes le issue/comentarios diretamente no Linear
  (evidencia MAI-59); nao existe comando Hermes/notify no Orca CLI e nenhum
  transporte lateral e usado.
- Entrega reportada so e persistida/promovida apos validacao exata de PR + SHA;
  relatorio divergente tem zero promocoes em dois ciclos (sem fallback por branch).
- Timeout retryavel de verdade: label e comentario so marcam `Done` apos escrita
  confirmada; falha mantem a etapa pendente, sem finalizar o timeout nem notificar
  antes de ambas confirmadas.
- Segredos nunca em canal persistente: Linear/estado sanitizados e logs via
  `sanitize_for_log` + `log_exception_safe` (cobertura por captura de logs).
- Cada evento contem estritamente identificador da issue e tipo do evento; o
  fingerprint vive so no `state.json/issues/<ID>/hermesNotified` para dedup.
- Dedup somente apos entrega confirmada: o fingerprint e gravado depois que o
  comentario e aceito; falha de entrega gera retry no proximo tick (sem perda
  definitiva) e repeticao do mesmo fingerprint gera zero escritas.
- Crash-safe no dipolo comentario/local: se o post for aceito mas o save local
  falhar, o proximo tick faz read-back remoto do comentario
  (`hermes_event_posted_remotely`) e reconcilia o fingerprint sem repostar.
  O comentario carrega `MeuPlantao-Hermes-Fp: <fingerprint>` fora do bloco JSON;
  o read-back exige o marcador do fingerprint corrente, de modo que comentario
  antigo nunca suprime evento de novo SHA (exactly-once por fingerprint).
- Contrato maquina: `hermes_payload()` emite exatamente `{issue, event}`;
  `parse_hermes_payload()` rejeita qualquer chave extra (cobertura por teste real
  com terceira chave); o comentario carrega o prompt + bloco ```json do payload.
  `expected_hermes_ack()` deriva o ack do estado corrente (review: `reviewMarker`
  atual; timeout: `dispatchId` atual; blocked: estatico), nunca de historico, e o
  precheck lista `expectedAck` por evento pendente. Scrubber comum cobre segredo
  em qualquer caixa (`Bearer`/`Authorization`), valores quoted com espaco e
  userinfo em URLs/connection strings (`sanitize_for_linear` e `sanitize_for_log`).
- Hermes faz verificacao rapida no GitHub, sem auditoria semantica automatica.
- Fingerprints: review = `ISSUE:needs-review:<PR>:<SHA>` (novo SHA reseta);
  blocked = `ISSUE:blocked`; timeout = `ISSUE:dispatch-timeout:<dispatchId>`.
  Repeticao do mesmo fingerprint = zero escritas (outbox e Linear intactos).

### Diagrama de estados

    Todo + Orca Ready
      |> claim: dispatchId estavel + status dispatching (claim persistido)
      |> side effect minimo: criar/reutilizar worktree + 1 agente autorizado
      |> sync: In Progress + remove Orca Ready (readback confirma)
      |> dispatched: segundo tick com mesmo dispatchId = skip (sem duplicar)
      |> PR aberta (base main): In Progress + Needs Review + Hermes needs-review 1x
      |> Linear Blocked: status blocked + Hermes blocked 1x
      |> dispatching alem do timeout sem In Progress: dispatch-timeout + Hermes 1x
      |> falha ambigua no side effect: dispatching + erro sanitizado, sem retry
      |> falha pre-side-effect: error + erro sanitizado, zero criacao

### Testes (TDD, `ops/meuplantao-dispatcher/test_dispatcher_linear_bus.py`)

- Caminho feliz com `dispatchId` persistido; segundo tick sem duplicar.
- Erro reportado avanca pelo Linear sem consultar terminal Orca.
- Timeout marca `dispatch-timeout`, notifica 1x e nao redispara.
- Crash ambiguo sanitizado nao causa retry nem segundo agente.
- Report Linear de entrega vira review sem descoberta pelo GitHub.
- Report Linear de erro e registrado sanitizado, sem segredos publicados.
- Timeout marca o Linear e notifica Hermes 1x.
- Review notifica Hermes 1x por fingerprint; novo SHA reseta.
- Blocked notifica Hermes 1x.
- Falha de entrega Hermes nao perde o evento (retry proximo tick).
- Evento Hermes contem estritamente issue + tipo.
- Relatorio divergente: zero Needs Review em dois ciclos.
- main() Linear-first: delivery/error/blocked via Linear com preflight invalido e sem terminal.
- Monitor fail-closed preservado; ack/precheck com fail-closed de Linear fora.
- Hermes: comentario ja postado nao reposta apos restart (read-back remoto).
- Hermes: payload estrito issue+event rejeita chave extra (fingerprint/prompt/at).
- Hermes: precheck inclui expectedAck por evento (review/blocked/timeout).
- Sanitizador composto pega segredo fora de prefixo conhecido de chave.
- Hermes: evento antigo nao suprime novo SHA (post por marcador de fingerprint).
- Hermes: expectedAck do estado corrente com historico misto review/timeout.
- Hermes: payload rejeita terceira chave por teste real.
- Sanitizacao de formatos reais: Bearer/Authorization, quoted, userinfo em URL.
- Timeout: falha de label/comentario no 1o ciclo retenta e finaliza so no 2o.
- Logs capturados sem tokens/senhas/credenciais.
- Sanitizacao de segredos efetiva; sem mutacao global de CONFIG nos testes.
- Nenhuma chamada a modelo/LLM no polling e na coordenacao.
- Sem policy/worker valido: zero criacao, zero mutacao indevida, erro sanitizado.

Suite completa: `python -m unittest discover -s ops/meuplantao-dispatcher -p "test_*.py"`
plus `git diff --check`. Base empilhada sobre o SHA da MAI-67; PR contra
`lMaick/MAI-67-desacoplar-preflight-modelo-unico` com dependencia explicita da PR #37.
