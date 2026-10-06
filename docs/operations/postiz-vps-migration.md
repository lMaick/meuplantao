# Postiz compartilhado na VPS — MAI-167

Issue: https://linear.app/maickagent/issue/MAI-167/migrar-postiz-local-para-vps-como-ferramenta-compartilhada

## Organização e acesso

Acesso: **https://postiz.maickdigital.cloud**, com a conta existente do Postiz.
A ferramenta é compartilhada entre projetos, em
`/home/ubuntu/workspace/ferramentas/postiz/`. Projetos continuam em
`/home/ubuntu/workspace/projetos/`.

| Caminho relativo | Conteúdo |
| --- | --- |
| `compose.json` | Stack Compose com imagens fixadas por digest |
| `.env.local` | Credenciais privadas; permissão 600; nunca versionar |
| `data/` | Bancos, Redis, uploads e Elasticsearch em bind mounts persistentes |
| `temporal-dynamicconfig/` | YAMLs do Temporal |
| `migration/backups/` | Backups originais, manifestos e mídias recuperadas do R2 |
| `backups/` | Backup completo após a migração e configuração anterior do Nginx |
| `bin/postizctl` | Comandos de manutenção |
| `logs/` | Evidências privadas da execução |

Diretório principal com permissão 700. Bind mounts respeitam os usuários das
imagens. Diretórios de dynamicconfig usam 755 e YAMLs 644, dentro da raiz privada.
O certificado e sua chave privada ficam no diretório padrão do Certbot em
`/etc/letsencrypt/`. A configuração do domínio fica em
`/etc/nginx/sites-available/postiz.maickdigital.cloud`.

## Execução verificada em 2026-10-06

- Ubuntu 24.04 ARM64; Docker Engine 29.8.2 e Compose 5.6.0.
- Postiz v2.23.0 preservado. Nove imagens com suporte ARM64, fixadas nos digests da
  instalação existente, sem atualizar `latest`.
- Origem efetiva: `C:\Users\Maick\Documents\postiz\docker-compose.yaml`, projeto
  Compose `postiz`; não confundir com a pasta `postiz-docker-compose`.
- Dumps lógicos dos dois bancos e cópias frias de seis volumes. Dados reais do
  Elasticsearch exportados também da camada gravável do container original:
  o volume anônimo configurado estava vazio. Destino com bind mount persistente.
- Treze arquivos do backup inicial conferidos por SHA-256 na VPS.
- Antes de ativar o aplicativo, as 69 tabelas públicas do Postiz e 37 do Temporal
  tinham contagens de linhas idênticas às da origem.
- Banco preservado: 1 usuário, 1 organização, 1 integração, 11 posts e 30 registros
  de mídia. Quatro posts publicados e sete erros cancelados logicamente. Nenhum
  post pendente, atrasado ou futuro na conferência antes da ativação.
- Elasticsearch restaurado saudável (`green`), com 22 documentos no índice de
  visibilidade; Temporal respondeu `SERVING`.
- Credenciais preservadas por comparação campo a campo. Alterações deliberadas:
  URLs do novo domínio, CORS do Temporal UI, armazenamento local e bloqueio de
  novos cadastros (`DISABLE_REGISTRATION=true`). Nenhuma rotação realizada.
- Frontend, backend e orchestrator online. HTTPS 200 na página de autenticação;
  API de integrações 200, com uma integração `instagram-standalone` habilitada.
  Isso comprova leitura da integração; não comprova nova autorização OAuth nem
  publicação em rede social. Nenhum conteúdo foi enviado como teste.
- Containers do PC parados com `restart=no`, mantendo volumes e políticas de
  reinício anteriores em inventário privado. Apenas a VPS executa o Postiz.
- Backup frio completo após a migração em `backups/2026-10-06T182220Z/`, com dumps
  lógicos e arquivo `data-and-config.tar.gz`; SHA-256 validado na VPS e na cópia
  privada do PC. A stack foi retomada e a API novamente conferida.

## Mídias

Por escolha do usuário, `STORAGE_PROVIDER=local`. As 19 imagens no Cloudflare R2
foram confirmadas e copiadas autenticadamente para
`data/postiz-uploads/r2-preserved/`, com hashes comparados. As referências de
mídia no banco foram ajustadas em transação para o novo domínio, preservando
IDs e registros. Foi salvo um dump imediatamente antes dessa alteração.
As 19 imagens recuperadas responderam HTTP 200 no domínio novo.

Onze registros históricos apontavam para `localhost:4007`. A varredura dos 21
volumes locais não encontrou os arquivos correspondentes. Esses registros
foram preservados e suas URLs ajustadas para o novo host; os arquivos continuam
ausentes, com HTTP 404. Não foram substituídos por imagens diferentes. Os links
públicos originais do R2 respondiam 403, embora os objetos existissem via API.
Nenhum objeto foi removido do R2.

## Manutenção

```sh
ssh nuvem
cd /home/ubuntu/workspace/ferramentas/postiz
bin/postizctl status
bin/postizctl logs postiz
bin/postizctl backup
```

`backup` pausa a stack brevemente para produzir uma cópia consistente dos bancos,
filas, uploads e configurações. Depois retoma os containers que estavam ativos.
Escolher uma janela sem publicações próximas. A cópia contém credenciais e dados
privados: manter acesso restrito e transferir para um destino seguro fora da VPS.
Não foi criado agendamento periódico de backups.

Os comandos `bin/postizctl stop` e `bin/postizctl start` operam somente esta stack.
As imagens usam `restart=unless-stopped` e Docker está habilitado no boot. Não
foi executado reboot da VPS para validação.

Evite imprimir `docker compose config` sem `--quiet`, pois o comando expande as
credenciais. Não publicar dumps ou logs crus. `bin/postizctl logs` usa um helper
que redige os valores secretos antes de mostrar logs.

O Certbot tem timer habilitado e hook de implantação que valida e recarrega
Nginx. Certificado inicial válido até 2027-01-04. O teste `certbot renew --dry-run --run-deploy-hooks` passou, incluindo o reload
do Nginx. Evidência em `logs/certbot-renewal-dry-run.log`.

## Cliente de marketing e reconexão do Instagram

`POSTIZ_URL=https://postiz.maickdigital.cloud` foi configurado no `.env.local`
ignorado do checkout principal do PC, preservando a chave existente. O cliente
atual escolhe a URL antes de carregar os arquivos `.env`. Para carregar a URL
antes do módulo, executar a partir do checkout:

```sh
node --env-file=.env.local ops/marketing/postiz-client.mjs status
```

Outros projetos/hosts precisam receber a URL e sua chave de API via configuração
privada; não copiar todas as credenciais de um projeto para outros projetos.

Ao reconectar Instagram, o aplicativo Meta deve aceitar o callback
`https://postiz.maickdigital.cloud/integrations/social/instagram-standalone`.
O painel Meta não foi alterado nem foi feita nova autorização OAuth nesta tarefa.
A conta existente foi preservada; uma reconexão manual poderá exigir esse ajuste.

## Retorno à instalação local

Parar primeiro o Postiz e seus workers na VPS. Nunca manter dois schedulers
ativos. Se a VPS recebeu novos posts ou alterações, exportar os dados atuais e
transferi-los de volta antes de iniciar uma origem antiga. Não restaurar dados
antigos silenciosamente.

A origem e suas credenciais permanecem preservadas. Restaurar explicitamente as
políticas de reinício do inventário privado e iniciar os containers necessários
somente após parar a instância remota. Ajustar a URL do cliente para a origem
escolhida. Não usar `down -v`, remover volumes, resetar Docker Desktop ou atualizar
imagens como parte do retorno.

## Referências

- https://docs.postiz.com/self-host/installation/docker-compose
- https://docs.postiz.com/self-host/installation/migration
- https://docs.docker.com/engine/install/ubuntu/

