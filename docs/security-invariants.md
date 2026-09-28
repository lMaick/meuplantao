# Invariantes de Segurança do Production Gate (RLS & Grants)

Verificação **read-only** do catálogo PostgreSQL (`pg_catalog` /
`information_schema` / `pg_policies`). Nenhuma mutação é executada.
Qualquer divergência **falha o production gate** (fail-closed).

## Origem da verdade

O estado esperado espelha as migrations em `supabase/migrations/`:

| Migration | Efeito relevante |
|---|---|
| `20260904204000_initial_schema` | RLS ON + policies `*_select_own` com `auth.uid()` |
| `20260905120000_financial_obligations` | `obligations` com RLS; `register_payment` EXECUTE p/ authenticated |
| `20260906140000_payment_update_integrity` | `payments_update_own` restrita a `status = 'cancelado'` |
| `20260906150000_remove_payments_delete_policy` | `payments_delete_own` removida (sem delete físico) |
| `20260909200000_financial_authority_table_privileges` | Sem UPDATE em tabela `shifts`/`obligations`; só colunas não-financeiras |
| `20260909190000_financial_authority_definer` | `save_shift_with_obligation` vira `SECURITY DEFINER` |
| `20260920140000_shifts_direct_write_prohibition` | Sem INSERT/UPDATE direto em `shifts`; sem policies `shifts_insert_own`/`shifts_update_own`; `grant select, delete` |
| `20260920000000_subscription_payments_idempotency` | `subscription_payments`: RLS + só `SELECT` p/ authenticated; resto `service_role` |
| `20260920120000_subscription_entitlement_boundary` | `has_active_entitlement` + entitlement no boundary |

## Invariantes checadas

### `public.shifts`
- `shifts.rls_enabled` — `relrowsecurity = true`.
- `shifts.no_insert_authenticated` — sem `INSERT` em `role_table_grants` para `authenticated`.
  Detecta drift manual tipo `GRANT INSERT ON shifts TO authenticated`.
- `shifts.no_update_authenticated` — sem `UPDATE` em tabela **nem** em colunas
  (`role_table_grants` + `role_column_grants`) para `authenticated`.
- `shifts.select_own` — `GRANT SELECT` + policy `shifts_select_own`
  (`FOR SELECT TO authenticated USING (auth.uid() = user_id)`).
- `shifts.no_direct_write_policies` — policies `shifts_insert_own` e
  `shifts_update_own` **não existem**.

### RPC `save_shift_with_obligation`
- `rpc.save_shift.execute_authenticated` — `has_function_privilege('authenticated', EXECUTE)`.
- `rpc.save_shift.security_definer` — `pg_proc.prosecdef = true`.
- `rpc.save_shift.no_anon_public` — sem `EXECUTE` para `anon`/`public`.

### `public.subscription_payments`
- `subscription_payments.rls_enabled` — RLS ON.
- `subscription_payments.no_write_authenticated` — sem `INSERT`/`UPDATE`/`DELETE`
  (tabela + colunas) para `authenticated`.
- `subscription_payments.select_isolated` — `GRANT SELECT` + policy
  `subscription_payments_select_own` com `auth.uid()` (usuário não lê
  pagamentos de outros usuários).

### `public.payments` / `public.obligations`
- `payments.rls_enabled` — RLS ON.
- `payments.no_delete_policy` — policy `payments_delete_own` não existe
  (proibido delete físico; cancelamento lógico auditável).
- `payments.select_isolated` — `payments_select_own` com `auth.uid()`.
- `payments.update_restricted` — `payments_update_own` com
  `WITH CHECK (status = 'cancelado')`.
- `obligations.rls_enabled` — RLS ON.
- `obligations.no_financial_update` — sem `UPDATE` em tabela nem na coluna
  `valor_devido` para `authenticated`.

## Como é verificado

`scripts/check-rls-invariants.mjs` executa 5 `SELECT`s (veja
`SECURITY_CATALOG_QUERIES`): RLS (`pg_class`), grants de tabela
(`role_table_grants`), grants de coluna (`role_column_grants`), policies
(`pg_policies`) e funções (`pg_proc` + `has_function_privilege`).

`scripts/smoke-test-schema.mjs` (`runSmokeTest`, modo strict) roda essa
verificação após confirmar as RPCs; divergência retorna `ok: false` e o
`prebuild` (`scripts/verify-production-schema.mjs`) aborta o deploy.
Em modo não-strict/preview a checagem é diagnóstica (warning, não bloqueia).

## Testes

`tests/security-invariants.test.mjs` testa o avaliador puro
`evaluateSecurityInvariants()` com fixtures/mocks de catálogo
(`buildCompliantCatalogFixture()` + mutações de drift), sem tocar no banco.
