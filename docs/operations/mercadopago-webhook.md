# Webhook Mercado Pago — Requisito operacional (Issue #113)

Guia do operador para o requisito de `MERCADO_PAGO_WEBHOOK_SECRET` em producao.
Nao contem segredos, tokens, URLs com credenciais ou stack traces.

## 1. Producao exige `MERCADO_PAGO_WEBHOOK_SECRET`

- Em producao, o webhook moderno (`POST /api/webhooks/mercadopago`) so opera
  com `MERCADO_PAGO_WEBHOOK_SECRET` configurado no ambiente servidor.
- Sem o secret em producao, o comportamento e falha fechada: o evento nao e
  processado e nenhuma assinatura e ativada ou estendida por esse evento.
- A ausencia do secret em producao nunca libera o processamento por fallback
  silencioso.

## 2. Dev/teste: comportamento sem secret e controlavel

- Fora de producao, o fallback sem secret pode permanecer habilitado para
  desenvolvimento/teste local por padrao.
- Defina `MERCADO_PAGO_ALLOW_MISSING_WEBHOOK_SECRET=false` para exigir o secret
  tambem fora de producao quando o ambiente de teste precisar de falha fechada.
- Essa configuracao nunca libera a ausencia do secret em producao, e seu valor
  nao deve ser copiado para variaveis de producao.

## 3. Webhook moderno x IPN legado (separacao)

- Webhook moderno: `POST /api/webhooks/mercadopago` (tambem aceita `GET` para
  verificacao do provedor).
  - Validacao moderna por HMAC (`x-signature` e `x-request-id` obrigatorios),
    protecao contra replay e consulta autenticada a API do Mercado Pago.
- IPN legado: `POST /api/webhooks/mercadopago/ipn` (tambem aceita `GET`).
  - Nao usa `x-signature`. A autenticidade e validada exclusivamente pela
    consulta autenticada a API do Mercado Pago.
- As duas rotas sao independentes. Configurar o secret do webhook moderno nao
  altera o contrato do IPN legado, e o IPN legado continua funcionando sem
  `x-signature`.

## 4. Respostas publicas em falha de configuracao

- Chamadas ao webhook moderno em falha de configuracao recebem uma resposta
  publica generica de falha de configuracao, sem detalhes internos.
- A resposta nao expoe valores de segredo, nomes de variaveis internas de
  infraestrutura, stack traces ou diagnostico destinado ao operador.
- Detalhes de diagnostico ficam restritos a logs/observabilidade no servidor,
  nunca no corpo da resposta publica nem em telas do app.

## 5. Onde o operador configura

- Configure `MERCADO_PAGO_WEBHOOK_SECRET` apenas no ambiente servidor
  (secrets do provedor de deploy/CI). Nunca versione o valor em codigo,
  commits, logs ou capturas de tela.
- Nao ha configuracao desse secret pela interface do app. Nao oriente
  usuarios a colar segredos em telas, formularios ou suporte via chat.
- Apos alterar o secret no provedor, faca novo deploy/build conforme o fluxo
  via PR para `main`. Nao ha merge proprio nem deploy direto pelo worker.

## 6. Checklist do operador

1. Producao possui `MERCADO_PAGO_WEBHOOK_SECRET` definido no servidor.
2. Dev/teste sem secret segue a configuracao explicita de allow/deny documentada.
3. Webhook moderno e IPN legado testados separadamente.
4. Resposta publica de falha de configuracao conferida como generica.
5. Nenhum segredo presente no repo, em UI client ou em evidencias.

Ref: GitHub issue #113. Replay protection e idempotencia sao preservados
conforme o contrato das rotas; a logica de validacao e coberta por outros
slices/PRs da mesma issue.

## 7. Rate limit e cooldown de billing (MAI-138)

- Todas as rotas de billing (`/api/webhooks/mercadopago`, `/api/webhooks/mercadopago/ipn`,
  `/api/mercadopago/checkout`, `/api/mercadopago/sync`, `/api/mercadopago/verify`)
  aplicam rate limit + cooldown ANTES de qualquer consulta ao Mercado Pago.
- MAI-149 (auditoria 2026-10-02): webhooks/IPN NUNCA retornam `200 { deduped: true }`
  sem consultar o Mercado Pago — nem com prova persistida nem dentro do cooldown
  curto (15s webhook / 30s IPN). O mesmo `payment_id` pode transitar
  `approved -> refunded/charged_back` dentro da janela e 200 não garante retry,
  logo a reversão seria perdida. Duplicatas sequenciais consultam o estado atual
  (fonte da verdade); `approved` repetido é idempotente via RPC
  (`already_processed`, sem nova vigência) e `refunded`/`charged_back` chegam a
  `reconcileMercadoPagoReversal()`; rajada CONCORRENTE recebe `429` retentável
  com `Retry-After` via lock in-flight (só o dono faz fetch). Abuso por
  IP/usuário recebe `429` com `Retry-After`.
  Falhas retentáveis (502/500/429 upstream) liberam o cooldown para preservar o
  retry legítimo do provedor; a idempotência financeira segue na RPC atômica.
- Store distribuído (nunca contador local como garantia global): Upstash Redis
  via REST em chamada ÚNICA (`EVAL` Lua: `INCR` + `PEXPIRE` atômicos, TTL
  garantido) quando `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` existem;
  senão Supabase (`billing_rate_limits` + RPC `billing_rate_limit_hit`, service_role);
  memória local só como fallback fail-open por instância, com log sanitizado.
  Nenhum log carrega segredos, tokens, corpo ou IP bruto (apenas hash truncado).
- Habilitação: ligado SEMPRE em produção; fora de produção exige
  `BILLING_RATE_LIMIT_ENABLED=true` (cobertura em `tests/billing-rate-limit.test.mjs`).
  `BILLING_RATE_LIMIT_DISABLED=true` desliga em qualquer ambiente (emergência).
- IPN legado em produção é DESABILITADO por padrão (`410 legacy_ipn_disabled`,
  sem consultar o Mercado Pago). Para manter temporariamente:
  `MERCADO_PAGO_ENABLE_LEGACY_IPN=true`. Fora de produção o padrão é habilitado.
