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

## Privilégios EFETIVOS via PUBLIC/herança (MAI-135)

A auditoria humana reprovou o SHA `4cd5c5a` porque filtrar
`role_table_grants` por `grantee = 'authenticated'` ignora privilégios
obtidos via `GRANT ... TO PUBLIC` ou herança de roles — o gate dizia "ok"
enquanto `authenticated` conseguia escrever de fato (falso negativo).

Desde MAI-135, as invariantes de INSERT/UPDATE usam os helpers nativos do
PostgreSQL, que computam o privilégio **efetivo** do papel (direto + PUBLIC
+ herança):

- `has_table_privilege('authenticated', 'public.<tabela>', '<privilege>')`
  para privilégios de tabela;
- `has_column_privilege('authenticated', 'public.<tabela>', '<coluna>', '<privilege>')`
  para privilégios de coluna (ex.: `obligations.valor_devido`).

As linhas nominais de `role_table_grants`/`role_column_grants` continuam
checadas como evidência adicional; qualquer uma das duas fontes acusa
divergência e falha o gate (fail-closed).

### `public.shifts`
- `shifts.rls_enabled` — `relrowsecurity = true`.
- `shifts.no_insert_authenticated` — sem `INSERT` **efetivo** para `authenticated`.
  Detecta drift manual tipo `GRANT INSERT ON shifts TO authenticated` **e**
  `GRANT INSERT ON shifts TO PUBLIC`.
- `shifts.no_update_authenticated` — sem `UPDATE` **efetivo** em tabela **nem** em colunas
  (inclui grants via `PUBLIC`/herança).
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
- `subscription_payments.no_write_authenticated` — sem escrita **efetiva**
  (`INSERT`/`UPDATE`/`DELETE`, tabela + colunas) para `authenticated`,
  incluindo grants via `PUBLIC`/herança.
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
- `obligations.no_financial_update` — sem `UPDATE` **efetivo** em tabela nem na coluna
  `valor_devido` para `authenticated` (inclui `GRANT UPDATE (valor_devido) ... TO PUBLIC`).

## Como é verificado

`scripts/check-rls-invariants.mjs` executa 7 `SELECT`s (veja
`SECURITY_CATALOG_QUERIES`): RLS (`pg_class`), grants nominais de tabela
(`role_table_grants`), grants nominais de coluna (`role_column_grants`),
policies (`pg_policies`), funções (`pg_proc` + `has_function_privilege`) e,
desde MAI-135, privilégios efetivos (`has_table_privilege` por
tabela × privilégio; `has_column_privilege` por coluna × privilégio).

`scripts/smoke-test-schema.mjs` (`runSmokeTest`, modo strict) roda essa
verificação após confirmar as RPCs; divergência retorna `ok: false` e o
`prebuild` (`scripts/verify-production-schema.mjs`) aborta o deploy.
Em modo não-strict/preview a checagem é diagnóstica (warning, não bloqueia).

## Testes

`tests/security-invariants.test.mjs` testa o avaliador puro
`evaluateSecurityInvariants()` com fixtures/mocks de catálogo
(`buildCompliantCatalogFixture()` + mutações de drift), sem tocar no banco —
incluindo cenários `GRANT ... TO PUBLIC` e a prova de que o SHA auditado
`4cd5c5a` não os detectava (falso negativo) enquanto o checker atual detecta.

`tests/security-invariants-real.local.mjs` (fora do `npm test`; rodar com
`npm run test:security-real`) executa o checker de verdade contra PostgreSQL
local: monta papéis/tabelas/policies, aplica drift temporário
(`GRANT ... TO PUBLIC` em `shifts`, `subscription_payments` e
`obligations.valor_devido`), observa o gate falhar em cada cenário e restaura
com `REVOKE` + `DROP` final. Nenhum banco remoto/produção é tocado.

## Safety guard do teste real (fail-closed)

O teste real é destrutivo (`DROP` de tabelas `public.*`, `DROP SCHEMA auth`,
`DROP ROLE`). Por isso `assertLocalDatabaseUrl()` (em
`scripts/check-rls-invariants.mjs`) aborta **antes de qualquer conexão**
quando `SECURITY_REAL_DATABASE_URL` não aponta para host local explícito.
Hosts permitidos: `127.0.0.1`, `localhost`, `::1` — lista fechada, sem flag
que libere remoto. Erro sanitizado (hostname apenas, sem userinfo/senha).

## Policies validadas por expressão canônica

Substring (`includes("auth.uid()")`) aceitaria policy enfraquecida como
`auth.uid() = user_id OR true`. `canonicalPolicyExpr()` normaliza
(minúsculas, sem espaços/parênteses, `(select auth.uid())` → `auth.uid()`) e
exige **igualdade** com o esperado:

- `selectOwnQual`: `auth.uid()=user_id` (shifts, subscription_payments, payments);
- `paymentsUpdateWithCheck`: `auth.uid()=user_idandstatus='cancelado'`.

## CI

Job isolado `PostgreSQL Security Invariants E2E` em
`.github/workflows/ci.yml`: container PostgreSQL 16 efêmero via `services`,
`SECURITY_REAL_REQUIRE_DB=1` (falha em vez de skipar se o banco não subir) e
URL sempre `localhost` — nunca Supabase remoto.

> **Sequenciamento:** a correção pode ser implementada agora, mas a evidência
> final de merge exige atualizar a branch contra `main` depois que a PR #130
> for aprovada e mergeada, para executar também o novo job de assinatura.
