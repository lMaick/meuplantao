# Reembolsos e chargebacks — Reconciliacao (MAI-136)

Guia operacional sem segredos. Nao contem tokens, chaves ou dados de pagador.

## 1. Achado confirmado

Antes desta issue, `webhook`, `ipn`, `verify` e `sync` processavam apenas
`status == approved`; qualquer outro estado era `200 {ignored:true}` sem tocar
o banco. Um `refunded`/`charged_back` posterior nao revogava
`subscription_payments` nem `subscriptions.current_period_end`: a vigencia
concedida permanecia intacta.

## 2. Regra de recomposicao da vigencia

- Ledger append-only: `subscription_payments` nunca e apagada. A reversao
  atualiza `status` para `refunded`/`charged_back`, preenche `reversed_at` e
  insere uma linha em `subscription_payment_events` (`approved -> refunded`).
- Recomposicao por replay dos pagamentos com `status='approved'` restantes,
  em ordem de `processed_at` original:
  - `cur = null`
  - para cada ativo: se `cur` e nulo ou `cur <= processed_at`,
    `cur = processed_at + validity_days`; senao `cur += validity_days`.
- Sem ativos restantes, a vigencia futura e revogada (teto em `now()`); o
  passado e preservado. `status` continua derivado: `active` se e somente se
  `current_period_end > now()`.
- Dois pagamentos (A 30d + B 90d) com A estornado convergem para ~90d de B,
  sem dupla contagem. Evento de estorno duplicado retorna `already_reversed`
  sem alterar o fim. Estorno fora de ordem (antes do aprovado) cria um stub
  revertido de contribuicao zero para que o `approved` tardio nao conceda
  vigencia (`already_processed`, sem dias).
- `in_mediation`/disputa NAO revoga automaticamente: a API responde
  `needs_review:true` e registra observabilidade para decisao humana.
  Politica comercial de uso parcial em disputa nao esta definida; por isso o
  sistema evita revogacao arbitraria.

## 3. Fonte da verdade e concorrencia

- Provedor Mercado Pago e fonte da verdade: webhook/IPN/verify/sync consultam
  `GET /v1/payments/:id` (ou search) autenticado e ramificam pelo estado atual
  do provedor, nunca pelo evento isolado. Uma notificacao `approved` antiga
  que chega apos o reembolso encontra o provedor em `refunded` e cai no ramo
  de reconciliacao.
- Serializacao por usuario via `pg_advisory_xact_lock` + `UNIQUE
  (mercadopago_payment_id)` + `ON CONFLICT DO NOTHING` nas duas RPCs.
- Ownership: `external_reference` x `metadata.user_id` divergentes sao
  ignorados; `reconcile_mercadopago_reversal` com `user_id` distinto retorna
  `ownership_mismatch:true` sem alterar nada.

## 4. Reconciliacao manual (operador)

Casos: disputa `in_mediation` com decisao comercial, pagamento aprovado no
banco mas `refunded` no provedor e nao reconciliado, ou stub fora de ordem.

```sql
-- 1. Inspecionar ledger + eventos (somente leitura)
select mercadopago_payment_id, user_id, status, validity_days, processed_at, reversed_at
  from public.subscription_payments where mercadopago_payment_id = '<PAYMENT_ID>';
select from_status, to_status, provider_status, created_at
  from public.subscription_payment_events
 where mercadopago_payment_id = '<PAYMENT_ID>' order by created_at;

-- 2. Confirmar o estado ATUAL no painel/API do Mercado Pago (fonte da verdade)
--    e a titularidade (external_reference/metadata) antes de qualquer escrita.

-- 3. Reconciliar via RPC (service_role, nunca anon/authenticated):
select public.reconcile_mercadopago_reversal('<PAYMENT_ID>', '<USER_UUID>', 'refunded', 1, 30, 12.90);
-- ou 'charged_back' conforme o provedor. A RPC e idempotente: repeticoes
-- retornam already_reversed sem dupla subtracao.
```

Nunca edite `subscriptions.current_period_end` manualmente nem apague linhas
de `subscription_payments` (delete fisico proibido pelo invariante financeiro).

## 5. Logs e privacidade

- Logs estruturados carregam apenas `payment_id`, `user_id`, `provider_status`,
  `needs_review` e contadores (`reversed`, `active_payments`).
- Sanitizacao central em `src/lib/observability` remove tokens, secrets, payer
  e payloads. Nenhum evento expoe email do pagador, cartao ou corpo bruto.
