#!/usr/bin/env bash
# ==============================================================================
# tests/shifts-direct-write-prohibition-real.sh
# Validação real contra PostgreSQL / Supabase para a migration:
# 20260920140000_shifts_direct_write_prohibition.sql
#
# Valida rigorosamente no Postgres as 7 garantias do contrato financeiro.
# ==============================================================================
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

migration_file="${1:-supabase/migrations/20260920140000_shifts_direct_write_prohibition.sql}"
if [ ! -f "$migration_file" ]; then
  echo "Migration file not found: $migration_file" >&2
  exit 1
fi

failure_log="$(mktemp)"
trap 'rm -f "$failure_log"' EXIT

echo "==> Aplicando migration de bloqueio de escrita direta em shifts..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null

echo "==> Verificando privilégios no catálogo do Postgres (pg_class/pg_attribute)..."
test "$(psql "$DATABASE_URL" -Atqc "select has_table_privilege('authenticated', 'public.shifts', 'INSERT')")" = "f"
test "$(psql "$DATABASE_URL" -Atqc "select has_table_privilege('authenticated', 'public.shifts', 'UPDATE')")" = "f"
test "$(psql "$DATABASE_URL" -Atqc "select has_table_privilege('authenticated', 'public.shifts', 'SELECT')")" = "t"
test "$(psql "$DATABASE_URL" -Atqc "select has_table_privilege('authenticated', 'public.shifts', 'DELETE')")" = "t"
test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.shifts', 'status', 'UPDATE')")" = "f"
test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.shifts', 'data', 'UPDATE')")" = "f"
has_idemp_col="$(psql "$DATABASE_URL" -Atqc "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shifts' and column_name = 'idempotency_key'")"
if [ "$has_idemp_col" = "1" ]; then
  test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.shifts', 'idempotency_key', 'UPDATE')")" = "f"
fi
echo "✔ Privilégios no catálogo verificados com sucesso."

echo "==> Configurando fixtures no Postgres..."
USER_A="00000000-0000-0000-0000-0000000000c1"
USER_B="00000000-0000-0000-0000-0000000000c2"
PLACE_A="00000000-0000-0000-0000-0000000000c3"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
delete from public.shifts where user_id in ('$USER_A', '$USER_B');
delete from public.places where user_id in ('$USER_A', '$USER_B');
delete from auth.users where id in ('$USER_A', '$USER_B');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('$USER_A', 'authenticated', 'authenticated', 'user-c1@example.test', 'fixture', now(), now(), now());

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('$USER_B', 'authenticated', 'authenticated', 'user-c2@example.test', 'fixture', now(), now(), now());

insert into public.places (id, user_id, nome) values ('$PLACE_A', '$USER_A', 'Hospital C');
commit;
SQL

# ------------------------------------------------------------------------------
# 1. POST direto em /rest/v1/shifts -> 403 / 42501
# ------------------------------------------------------------------------------
echo "==> Testando 1: INSERT direto na tabela shifts por authenticated deve falhar com 42501..."
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
insert into public.shifts (user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
values ('$USER_A', '$PLACE_A', '2026-09-25', '08:00', '18:00', 1000, 'agendado');
reset role;
SQL
then
  echo "ERRO: INSERT direto em shifts teve sucesso inesperado!" >&2
  exit 1
fi

grep -q '42501' "$failure_log"
echo "✔ Garantia 1 aprovada: INSERT direto rejeitado com 42501."

# ------------------------------------------------------------------------------
# 3. Criação pela RPC -> sucesso
# ------------------------------------------------------------------------------
echo "==> Testando 3: Criação de plantão via save_shift_with_obligation tem sucesso..."
SHIFT_A="$(psql "$DATABASE_URL" -Atqc "
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select id from save_shift_with_obligation(
  null,
  '$PLACE_A',
  '2026-09-25'::date,
  '08:00'::time,
  '18:00'::time,
  1200.00,
  'agendado'
);
" | tail -n 1)"

test -n "$SHIFT_A"
test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '$SHIFT_A'")" = "1200.00"
echo "✔ Garantia 3 aprovada: Criação via RPC bem-sucedida."

# ------------------------------------------------------------------------------
# 2. PATCH direto em shifts -> rejeitado (42501)
# ------------------------------------------------------------------------------
echo "==> Testando 2: UPDATE direto em shifts por authenticated deve falhar com 42501..."
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
update public.shifts set status = 'realizado' where id = '$SHIFT_A';
reset role;
SQL
then
  echo "ERRO: UPDATE direto em shifts teve sucesso inesperado!" >&2
  exit 1
fi

grep -q '42501' "$failure_log"
echo "✔ Garantia 2 aprovada: UPDATE direto rejeitado com 42501."

# ------------------------------------------------------------------------------
# 4. RPC status=realizado -> exatamente 1 obligation
# ------------------------------------------------------------------------------
echo "==> Testando 4: Transição para realizado via RPC cria exatamente 1 obligation..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select save_shift_with_obligation(
  '$SHIFT_A',
  '$PLACE_A',
  '2026-09-25'::date,
  '08:00'::time,
  '18:00'::time,
  1200.00,
  'realizado',
  '2026-10-10'::date,
  '$PLACE_A',
  null
);
reset role;
SQL

test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where shift_id = '$SHIFT_A'")" = "1"
test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '$SHIFT_A'")" = "1200.00"
echo "✔ Garantia 4 aprovada: Realizado possui exatamente 1 obligation com valor igual ao plantão."

# ------------------------------------------------------------------------------
# 5. Retry da RPC com mesma idempotency_key -> não duplica shift nem obligation
# ------------------------------------------------------------------------------
echo "==> Testando 5: Retry com idempotency_key não duplica registros..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select save_shift_with_obligation(
  null,
  '$PLACE_A',
  '2026-09-28'::date,
  '08:00'::time,
  '18:00'::time,
  1500.00,
  'realizado',
  '2026-10-15'::date,
  '$PLACE_A',
  null,
  'idemp-test-shift-42'
);
-- Retry com a mesma chave e mesmo payload
select save_shift_with_obligation(
  null,
  '$PLACE_A',
  '2026-09-28'::date,
  '08:00'::time,
  '18:00'::time,
  1500.00,
  'realizado',
  '2026-10-15'::date,
  '$PLACE_A',
  null,
  'idemp-test-shift-42'
);
reset role;
SQL

test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.shifts where user_id = '$USER_A' and idempotency_key = 'idemp-test-shift-42'")" = "1"
echo "✔ Garantia 5 aprovada: Retry idempotente preserva unicidade."

# ------------------------------------------------------------------------------
# 6. Usuário B não consegue modificar shift de A
# ------------------------------------------------------------------------------
echo "==> Testando 6: Usuário B não consegue modificar shift de A via RPC..."
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_B', false);
select save_shift_with_obligation(
  '$SHIFT_A',
  '$PLACE_A',
  '2026-09-25'::date,
  '08:00'::time,
  '18:00'::time,
  9999.00,
  'agendado'
);
reset role;
SQL
then
  echo "ERRO: Usuário B conseguiu alterar shift de A via RPC!" >&2
  exit 1
fi

grep -q '23503' "$failure_log"
echo "✔ Garantia 6 aprovada: Modificação cruzada rejeitada com 23503."

# ------------------------------------------------------------------------------
# 7. Exclusão de plantão agendado permitida e de realizado bloqueada
# ------------------------------------------------------------------------------
echo "==> Testando 7: DELETE direto em shifts realizado é bloqueado..."
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
delete from public.shifts where id = '$SHIFT_A';
reset role;
SQL
then
  echo "ERRO: DELETE de shift realizado teve sucesso inesperado!" >&2
  exit 1
fi

grep -q '23514' "$failure_log"
echo "✔ Garantia 7 aprovada: Invariante de integridade financeira de exclusão preservada."

echo "=========================================================================="
echo "TODAS AS 7 GARANTIAS DO CONTRATO FINANCEIRO VALIDADAS COM SUCESSO!"
echo "=========================================================================="
