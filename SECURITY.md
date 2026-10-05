# Segurança do repositório

Não publique credenciais, valores de tokens, respostas de provedores nem arquivos
de recuperação em issues, PRs ou logs. Para relatar um incidente, contate o dono
do projeto por um canal privado; publique somente metadados sanitizados.

1. Revogue/rotacione primeiro; confirme que a chave antiga falha e a nova funciona,
   sem registrar os valores. Remover um arquivo ou reescrever Git não revoga uma chave.
2. Suspenda pushes durante uma limpeza coordenada. Inventarie branches, tags,
   refs de PR, clones, worktrees e forks antes de decidir a intervenção.
3. Faça backup privado com acesso restrito e simule a limpeza numa cópia separada.
   O dono/coordenador deve aprovar estratégia e OIDs esperados antes do force push.
4. Confira integridade, proteção do repositório e CI após a operação. Ressincronize
   clones antes de permitir novos pushes. Siga o [procedimento de limpeza](docs/security/git-history-cleanup.md).

## Prevenção vigente

GitHub Secret Scanning e Push Protection estão habilitados (verificados em
2026-10-04). Eles não reconhecem todos os formatos de tokens. O job
`Secret scan (redacted)` usa Gitleaks 8.30.1 com regras padrão e detecção de
literais opacos de API, incluindo Postiz. A versão Linux tem checksum SHA-256
fixado no workflow; a instalação não usa actions adicionais nem credenciais.

Antes de commitar, instale essa versão a partir das releases oficiais, confira
o checksum e execute (no PowerShell, use `$env:GITLEAKS_BIN` para o caminho):

```text
node scripts/scan-secrets.mjs --self-test
git add <arquivos revisados>
node scripts/scan-secrets.mjs
node scripts/scan-secrets.mjs --range BASE_SHA..HEAD_SHA
```

O scan padrão cobre todos os blobs rastreados no index, inclusive alterações
staged. Não lê configs locais ignorados nem o conteúdo de submodules. O CI
também examina cada commit introduzido: adicionar e apagar um token no mesmo PR
não evita a detecção. O comando `--all-history` audita todas as refs locais;
Push sem base disponível ou sem ancestralidade (como uma limpeza de histórico)
usa `--push-range`, que examina todo o histórico novo; PR com base ausente falha.
o scan de conteúdo atual **não é evidência de histórico limpo**. PRs iniciais de
prevenção podem passar mesmo enquanto o incidente histórico está sob tratamento.

Somente fixtures sintéticas específicas de três arquivos de testes e um
placeholder histórico do exemplo Postiz, vinculados ao valor e caminho por
condição AND, têm exceção documentada na configuração. Não exclua diretórios
de testes, não adicione baseline de credenciais reais nem comentários para bypass.
O wrapper ignora bypass inline e publica somente regra, arquivo e linha; nunca
publica valor, trecho, autor ou mensagem do commit. Falhas de ferramenta e index
em conflito bloqueiam a execução.

Credenciais operacionais pertencem a `.env.local`/secrets do CI ou armazenamento
privado fora do checkout. `.env.*`, arquivos privados de chave e variações de
`ops/marketing/postiz-config.*.json` ficam ignorados; apenas exemplos com
placeholders devem ser rastreados. Ignore não remove arquivos já rastreados.

Fontes: [Gitleaks](https://github.com/gitleaks/gitleaks),
[GitHub Push Protection](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection).
