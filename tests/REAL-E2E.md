# E2E real (MAI-54 / MAI-62 / MAI-126 / MAI-134)

O teste real exige `RUN_REAL_E2E=1`, uma instância de teste e dois usuários em
`E2E_USER_A_EMAIL`, `E2E_USER_A_PASSWORD`, `E2E_USER_B_EMAIL` e
`E2E_USER_B_PASSWORD`. A URL e a anon key são lidas de
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` somente no
ambiente. O job obrigatório do CI inicia um Supabase local no runner Ubuntu,
aplica todas as migrations e cria usuários efêmeros pela Admin API em runtime;
nenhum GitHub Secret é necessário ou versionado.

O cenário valida Auth, RLS cruzada, plantão realizado, obrigação, pagamentos
parcial/total, overpayment, cancelamento lógico, atraso e duas requisições
concorrentes que disputam o mesmo saldo. A corrida HTTP é evidência de
integração; a garantia transacional vem da migration `FOR UPDATE`. Configuração
ausente ou serviço indisponível falha quando o gate é habilitado. O workflow
sempre para o stack local em `finally`/`trap`.

## Subscription Payment E2E (MAI-126 + MAI-134)

`tests/subscription-payment-real-e2e.real.mjs` valida diretamente a RPC
`process_mercadopago_subscription_payment` no PostgreSQL real. Sem mocks.

Requer: `RUN_REAL_E2E=1`, `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. Os valores vêm do Supabase local efêmero via CI
(`supabase status -o env`); nenhum secret do GitHub é necessário.

9 cenários verificam no banco diretamente:
- UNIQUE em `mercadopago_payment_id` (impede duplicação)
- `already_processed: true` no reprocessamento (sem extensão de vigência)
- Vigência acumulada corretamente em pagamentos sequenciais e concorrentes
- `pg_advisory_xact_lock` serializa concorrência sem race condition
- Upsert atômico funciona mesmo sem linha prévia em `subscriptions`
- payment_id de userA não estende assinatura de userB
- **Cenário 8 (MAI-134):** `validity_days=0`, `validity_days=-30`, `months=0`,
  `months=-1` — cada sub-cenário retorna SQLSTATE `22023` com **rollback total**:
  zero linhas em `subscription_payments`, nenhuma alteração em `subscriptions`
- amount, months, status, processed_at armazenados conforme contrato

### Migration MAI-134

`supabase/migrations/20260928210000_subscription_payment_validity_guard.sql`
corrige o finding da auditoria: `coalesce(p_validity_days, 30)` sem bloquear
zero/negativo foi substituído por guard `if v_validity_days <= 0 then raise
exception using errcode = '22023'`. Idem para `months`. O guard é executado
**antes** do advisory lock e do INSERT — garantindo rollback total.

Job CI: `Supabase Subscription Payment E2E` em `.github/workflows/ci.yml`.
Script local: `npm run test:subscription-real`.
