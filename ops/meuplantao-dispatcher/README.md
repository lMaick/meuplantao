# MeuPlantao dispatcher

Dispatcher operacional Linear -> Orca, isolado do código do produto. Copie
`config.example.toml` para `config.toml` e preencha os paths e o ID do workspace
Linear; não coloque tokens ou credenciais nesse arquivo.

Execute `python test_dispatcher.py` e depois `run-dispatcher.cmd --dry-run`.
O Task Scheduler deve receber `task-scheduler.xml` com os placeholders
substituídos. `InteractiveToken` é um risco conhecido: requer sessão interativa.

O dispatcher usa lock, limita o dispatch, reconcilia falhas pós-criação e mantém
Linear em `In Progress`; PRs recebem `Needs Review`. Nunca marca `Done` nem faz
merge. Estado, logs, lock e sessões são locais e ignorados pelo Git.
