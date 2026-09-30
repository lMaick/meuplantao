# Reembolsos e chargebacks — Reconciliacao (MAI-136/MAI-147)

Guia operacional sem segredos. Nao contem tokens, chaves ou dados de pagador.

Consolidacao MAI-147: este documento descreve a semantica unica vigente apos a
convergencia de MAI-136 (reversoes) e MAI-137 (validacao pre-concessao).
Definicao canonica em
`supabase/migrations/20260929200000_subscription_reversal_reconciliation.sql`
(RPC) e `20260929300000_subscription_checkout_single_consumption.sql`
(consumo unico de cotacao).

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
- Recomposicao = MAIOR entre:
  - (a) replay dos pagamentos com `status='approved'` restantes, em ordem de
    `processed_at` original:
    - `cur = null`
    - para cada ativo: se `cur` e nulo ou `cur <= processed_at`,
      `cur = processed_at + validity_days`; senao `cur += validity_days`.
  - (b) piso decremental: `current_period_end` anterior menos os
    `validity_days` do pagamento estornado. Preserva vigencia legitima sem
    lastro modelado no ledger (trial/vigencia anterior ou legado), removendo
    apenas a contribuicao do pagamento revertido.
- Sem ativos e sem lastro anterior, a vigencia futura e revogada; o passado e
  preservado.
- Escrita restrita ao dominio do CHECK `subscriptions_status_check`
  (`trialing/active/past_due/canceled/unpaid`): fim futuro grava `active`,
  caso contrario grava `canceled` (preserva a semantica de `calculateTrial`).
  O rotulo `expired` e apenas derivado na resposta da RPC, nunca persistido.
- Dois pagamentos (A 30d + B 90d) com A estornado convergem para ~90d de B,
  sem dupla contagem. Evento de estorno duplicado retorna `already_reversed`
  sem alterar o fim. Estorno fora de ordem (antes do aprovado) cria um stub
  revertido de contribuicao zero para que o `approved` tardio nao conceda
  vigencia (`already_processed`, sem dias); corrida stub x aprovado concorrente
  cai no fluxo compartilhado (ownership/idempotencia/reconciliacao).
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
- Consumo unico de cotacao (MAI-147): a associacao checkout <-> payment ID
  ocorre atomicamente na transacao que concede vigencia
  (`p_checkout_id` em `process_mercadopago_subscription_payment`, com lock
  `FOR UPDATE` da cotacao + indice unico parcial em `completed_payment_id`).
  Dois payment IDs concorrentes disputando a mesma cotacao: o perdedor recebe
  `23505 'Cotacao ja consumida por outro pagamento'` e cai em quarentena
  (`checkout_already_completed`), sem retry infinito. Marcar `completed` apos
  a RPC, em chamada separada, nao basta — e apenas fallback best-effort CAS.
- Pro nunca e concedido sem vinculo verificavel: checkout escolhido apenas por
  usuario + moeda + valor e proibido; pagamento sem `checkout_id`
  (metadata/external_reference) nem `preference_id` vinculada vai para
  quarentena (`unlinked_payment_requires_review`).
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
