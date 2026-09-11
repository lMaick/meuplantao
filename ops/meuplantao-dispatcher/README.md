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
   Linear e geram um evento Hermes persistido exatamente uma vez por fingerprint
   (issue + PR + SHA para review; issue + marcador para os demais; novo SHA reseta
   o fingerprint). Entrega reportada so e persistida/promovida apos validacao exata
   de PR + SHA; relatorio divergente nunca avanca, nem via fallback por branch.
   O `workerReport` e construido em ponto unico na ingestao (MAI-70): apenas a
   URL canonica verificada e o resumo `tests` sanitizado e limitado; campos crus
   do comentario nunca entram no estado. Canonicalizacao convergente fail-closed
   (MAI-72): `canonicalize_untrusted_text` aplica unquote ate fixpoint com limite
   de 25 rodadas e 200000 caracteres; entrada que nao converge ou estoura o limite
   vira `[REDACTED]`; o scrub de segredos roda so apos a convergencia.
  Normalizacao de escapes Unicode/JSON antes do scrub (MAI-75): cada rodada do
  fixpoint aplica unquote + decodificacao de escapes; pares surrogate validos sao
  combinados, unidades `\uXXXX` solitarias/invalidas permanecem inertes e
  escapes JSON simples rodam em passada unica; malformados nao geram excecao com
  entrada crua e o mesmo teto (25 rodadas, 200000 caracteres) derruba
  nao-convergente/estouro para `[REDACTED]`.
   Objeto PR canonico unico (MAI-73): `report.pr` e entrada nao confiavel usada so
   como lookup; `workerReport.pr`, campo superior `issue.pr`, attachment, comentario
   e `reviewMarker` derivam exclusivamente do objeto validado por `canonical_pr`
   (HTTPS, host `github.com`, path `/<github_repo>/pull/<number>` com numero
   conferido, sem userinfo/porta/query/fragmento; copia normalizada com numero int,
   SHA em minusculas e URL reconstruida; desvio falha fechado sem persistencia
   parcial). Gates na ingestao: `gh_pr_for_url` retorna objeto canonico,
   `sync_worker_reports` re-valida e `monitor_deliveries` valida a saida de
   `gh_pr_for_branch` antes de comparar/promover.
  Schema PR fechado (MAI-76): `canonical_pr` constroi a saida campo a campo com
  exatamente `number/headRefOid/url/statusCheckRollup`, sem `dict(raw)` e sem mutar
  a entrada; `number` e int nao-bool maior que zero ou string decimal, `headRefOid`/`url`
  exigem `str`, SHA nao-vazio de ate 128 chars em minusculas e cada check exige `dict`
  com `name` de `name||context` e `conclusion` de `conclusion||state||status` (strings com
  strip e teto de 300; ausente/None vira `[]`); ambiguidade falha fechado.
  Enforcement no sink (MAI-77): `mark_for_review` abre com `canonical_pr(pr)`
  antes de qualquer mutacao de estado; chamada direta nao canonica falha fechado
  (`RuntimeError`) sem promover nem persistir, e todos os callers passam pela mesma
  fronteira.
   Etapas de marcacao de timeout so concluem apos escrita confirmada no Linear;
   falha mantem a etapa pendente para retry no proximo tick, sem finalizar o
   timeout nem notificar antes de label e comentario confirmados.
   Outcomes do Linear sao processados primeiro em cada tick, antes de qualquer
   dependencia de worker/terminal (`poll_linear_outcomes` abre o tick); resultado
   ou erro ja publicado avancam mesmo com preflight invalido ou sem terminal.
   `reconcile_dispatches` permanece so como recuperacao excepcional e
   `monitor_deliveries` continua fail-closed no preflight (sem worker valido:
   zero mutacao no Linear).
6. Acionamento Hermes em duas partes, sem LLM no dispatcher. (a) Evento duravel:
   comentario Linear com instrucao minima mais bloco JSON estrito de exatamente
   `{issue, event}` (validavel por `parse_hermes_payload`); o dedup e guardado em
   `state.json` (`hermesNotified`) somente apos o comentario confirmado; falha gera retry no proximo
   tick (sem perda); entrega reconcilia por leitura remota, de modo que queda entre
   aceite remoto e save local nunca duplica o evento (idempotente e crash-safe).
   O comentario carrega ainda a linha `MeuPlantao-Hermes-Fp: <fingerprint>` (fora
   do bloco JSON, que segue estrito); o read-back so reconcilia quando o marcador
   do fingerprint corrente esta presente, de modo que comentario antigo nunca
   suprime evento de novo SHA (exactly-once por fingerprint).
   (b) Gate de consumo: `run-dispatcher.cmd --hermes-precheck`
   (somente leitura, sem lock) lista eventos emitidos ainda sem
   `MeuPlantao-Ack: <fingerprint>` na issue (exit 0 = ha pendencias, exit 1 =
   quieto), cada um com o `expectedAck` derivado do estado corrente
   (review: reviewMarker atual; timeout: dispatchId atual; blocked: estatico),
   nunca de comentario historico, para o consumidor nunca reconhecer ocorrencia
   antiga e deixar a atual pendente.
   Linear inacessivel e fail-closed como pendente. O Hermes, ao consumir
   cada evento, posta `MeuPlantao-Ack: <fingerprint>`. (c) Atuador: automacao Orca
   do operador (contrato suportado: `orca automations create --trigger <cron>
   --precheck "<DISPATCHER_DIR>\run-dispatcher.cmd --hermes-precheck" --prompt
   "<prompt Hermes com ack>" --provider <agent>`), NAO criada nesta PR (AppData e
   rollout sao do dono; criacao vedada pela auditoria). Nenhuma excecao com
   potencial sensivel e registrada sem sanitizacao (`sanitize_for_log` +
   `log_exception_safe` cobrem Linear/estado/logs; o scrubber comum cobre
   Bearer/Authorization em qualquer caixa, valores quoted com espaco e
   userinfo em URLs/connection strings).

Protocolo do worker (unica fonte de conclusao no fluxo normal): ao concluir ou
travar, o worker registra na issue um comentario `MeuPlantao-Report: delivery
pr=<PR-URL> sha=<SHA> tests=<resumo>` ou `MeuPlantao-Report: error|blocked
<texto>` sanitizado e sem segredos. O dispatcher le conclusao/erro/review
exclusivamente pelos comentarios/estados do Linear; o `gh` apenas verifica
uma PR ja reportada (aberta, base `main`, SHA igual ao reportado) e nunca
descobre entrega sozinho. `Dispatch Timeout` e persistido no Linear (label
`timeout_label` + comentario), nao so no `state.json`. Erros publicados no
Linear passam por sanitizacao de segredos (tokens, chaves, credenciais).

Diagrama de estados (Linear + estado local):

    Todo + Orca Ready
      -> dispatching (claim + dispatchId)
      -> In Progress (dispatched)
      -> In Progress + Needs Review (PR/SHA; evento Hermes 1x por fingerprint)
      -> Blocked (evento 1x) | dispatch-timeout (evento 1x; sem redispatch)
      -> Hermes consome e posta MeuPlantao-Ack; --hermes-precheck lista nao-ack

Entrega fica em `In Progress + Needs Review`; nunca `Done` antes do merge confirmado.
Lock, filtros, maximo por tick, review gate e proibicao de auto-merge preservados.

Testes: `python -m unittest discover -s ops/meuplantao-dispatcher -p "test_*.py"`
(caminho feliz, erro reportado via Linear sem GitHub, timeout com marca no Linear,
crash ambiguo sanitizado sem retry, entrega Hermes duravel (falha nao perde evento),
deduplicacao Hermes, novo SHA resetando fingerprint, evento estrito issue+tipo,
sanitizacao de segredos, relatorio divergente com zero promocoes em dois ciclos,
timeout com label/comentario retryaveis (falha-nao-finaliza), logs sem segredos
(captura de logs), main() Linear-first com preflight invalido (delivery/error/
blocked via Linear sem terminal), monitor fail-closed, ack/precheck (incl.
fail-closed com Linear fora), transporte com dedup/retry/crash-safe,
crash pos-aceite remoto sem duplicar, reconciliacao remota sem post,
sanitizacao de nomes compostos (OPENAI_API_KEY, SERVICE_ROLE_KEY, access_token),
payload JSON estrito {issue,event} (extras rejeitados por teste real), ack derivavel
do estado corrente (review/timeout, sem historico) e expectedAck no precheck,
read-back por marcador de fingerprint (evento antigo nao suprime novo SHA),
sanitizacao de formatos reais (Bearer/Authorization, quoted, userinfo em URL),
sem policy/worker, sem LLM no polling, sem mutacao global de CONFIG, objeto PR canonico ponta a ponta (state/attachment/
   comentario com URL canonica exata), verificador adulterado sem sinks (8 formas),
   monitor rejeitando branch PR com numero divergente, `gh_pr_for_url` com objeto
   validado, canonicalizacao convergente com limites (nao-convergente/superlimite
   vira [REDACTED]) e payload grande limitado, matriz Unicode/JSON ate fixpoint,
   schema PR fechado com tipos exatos e fronteira `mark_for_review` fail-closed com sinks inspecionados).

Entrega na PR #39 contra `main` (integracao final; MAI-67/PR #37 sao historico,
nao dependencia ativa); sem merge/rollout pelo agente.
