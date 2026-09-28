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

## 2. Dev/teste: comportamento sem secret exige opt-in explicito

- Fora de producao, operar sem secret somente e permitido mediante
  configuracao explicita de dev/teste.
- Nao existe modo implicito "sem secret" herdado para producao.
- O opt-in de dev/teste nunca deve ser copiado para variaveis de producao.

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
2. Dev/teste sem secret so existe com opt-in explicito documentado.
3. Webhook moderno e IPN legado testados separadamente.
4. Resposta publica de falha de configuracao conferida como generica.
5. Nenhum segredo presente no repo, em UI client ou em evidencias.

Ref: GitHub issue #113. Replay protection e idempotencia sao preservados
conforme o contrato das rotas; a logica de validacao e coberta por outros
slices/PRs da mesma issue.
