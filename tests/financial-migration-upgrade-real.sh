#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
test "$#" -ge 1 || { echo "migration file(s) required" >&2; exit 1; }
migration_file="${1:?migration file is required}"
immutability_file="${2:-}"
authority_file="${3:-}"
authority_fix_file="${4:-}"
if [ -z "$authority_fix_file" ] && [ -n "$authority_file" ]; then
  candidate_fix="$(dirname "$authority_file")/20260909200000_financial_authority_table_privileges.sql"
  if [ -f "$candidate_fix" ]; then
    authority_fix_file="$candidate_fix"
  fi
fi
failure_log="$(mktemp)"
trap 'rm -f "$failure_log"' EXIT

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000065', 'authenticated', 'authenticated', 'legacy-mai65@example.test', 'fixture', now(), now(), now());
insert into public.places (id, user_id, nome)
values ('00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-000000000065', 'Legacy fixture');
insert into public.shifts (id, user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
values ('00000000-0000-0000-0000-000000000067', '00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-000000000066', '2026-01-01', '08:00', '09:00', 100, 'agendado');
insert into public.obligations (id, user_id, shift_id, valor_devido, data_prevista, responsavel_place_id)
values ('00000000-0000-0000-0000-000000000068', '00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-000000000067', 100, '2026-01-02', '00000000-0000-0000-0000-000000000066');
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000069', 'authenticated', 'authenticated', 'legacy-history-mai65@example.test', 'fixture', now(), now(), now());
insert into public.places (id, user_id, nome)
values ('00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000069', 'Legacy history fixture');
insert into public.shifts (id, user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-000000000070', '2026-01-03', '08:00', '09:00', 100, 'agendado');
insert into public.obligations (id, user_id, shift_id, valor_devido, data_prevista, responsavel_place_id)
values ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-000000000071', 100, '2026-01-04', '00000000-0000-0000-0000-000000000070');
update public.shifts set status = 'realizado' where id = '00000000-0000-0000-0000-000000000071';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000069', true);
insert into public.payments (id, user_id, obligation_id, valor, data_pagamento, status)
values ('00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-000000000072', 40, '2026-01-04', 'registrado');
update public.payments set status = 'cancelado' where id = '00000000-0000-0000-0000-000000000073';
update public.shifts set status = 'agendado' where id = '00000000-0000-0000-0000-000000000071';
reset request.jwt.claim.sub;
commit;
SQL

before="$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where id = '00000000-0000-0000-0000-000000000068'")"
test "$before" = 1
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$migration_file" >"$failure_log" 2>&1; then
  echo 'legacy preflight unexpectedly succeeded' >&2
  exit 1
fi
grep -q '23514' "$failure_log"
after="$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where id = '00000000-0000-0000-0000-000000000068'")"
test "$after" = 1
shift_status="$(psql "$DATABASE_URL" -Atqc "select status from public.shifts where id = '00000000-0000-0000-0000-000000000067'")"
test "$shift_status" = agendado
test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where shift_id = '00000000-0000-0000-0000-000000000071'")" = 1
test "$(psql "$DATABASE_URL" -Atqc "select status from public.payments where id = '00000000-0000-0000-0000-000000000073'")" = cancelado

# Explicit, reviewed reconciliation: only the incompatible row with no
# payment history is removed. This is outside the migration and auditable.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
delete from public.obligations o
 where o.id = '00000000-0000-0000-0000-000000000068'
   and not exists (select 1 from public.payments p where p.obligation_id = o.id and p.user_id = o.user_id);
commit;
SQL
reconciled="$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where id = '00000000-0000-0000-0000-000000000068'")"
test "$reconciled" = 0

# Conservative reconciliation for incompatible history: restore the shift to
# realizado, preserving the obligation and every payment row.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
update public.shifts
   set status = 'realizado'
 where id = '00000000-0000-0000-0000-000000000071'
   and status <> 'realizado';
commit;
SQL
test "$(psql "$DATABASE_URL" -Atqc "select status from public.shifts where id = '00000000-0000-0000-0000-000000000071'")" = realizado
test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where shift_id = '00000000-0000-0000-0000-000000000071'")" = 1
test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.payments where id = '00000000-0000-0000-0000-000000000073'")" = 1

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
test "$(psql "$DATABASE_URL" -Atqc "select (select count(*) from public.obligations where shift_id = '00000000-0000-0000-0000-000000000071') || ':' || (select status from public.shifts where id = '00000000-0000-0000-0000-000000000071') || ':' || (select count(*) from public.payments where id = '00000000-0000-0000-0000-000000000073')")" = 1:realizado:1

if [ -n "$immutability_file" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
alter table public.shifts disable trigger shifts_realized_obligation_valid;
SQL
  test "$(psql "$DATABASE_URL" -Atqc "select tgenabled from pg_trigger where tgname = 'shifts_realized_obligation_valid'")" = D
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000080', 'authenticated', 'authenticated', 'divergent-mai65@example.test', 'fixture', now(), now(), now());
insert into public.places (id, user_id, nome)
values ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000080', 'Divergent fixture');
insert into public.shifts (id, user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
values ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000080', '00000000-0000-0000-0000-000000000081', '2026-02-01', '08:00', '09:00', 100, 'agendado');
insert into public.shifts (id, user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
values ('00000000-0000-0000-0000-000000000083', '00000000-0000-0000-0000-000000000080', '00000000-0000-0000-0000-000000000081', '2026-02-02', '10:00', '11:00', 100, 'agendado');
update public.shifts set status = 'realizado' where id in ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000083');
update public.obligations set valor_devido = 90 where shift_id = '00000000-0000-0000-0000-000000000082';
update public.obligations set valor_devido = null where shift_id = '00000000-0000-0000-0000-000000000083';
commit;
SQL
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
alter table public.shifts enable trigger shifts_realized_obligation_valid;
SQL
  test "$(psql "$DATABASE_URL" -Atqc "select tgenabled from pg_trigger where tgname = 'shifts_realized_obligation_valid'")" = O
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000082'")" = 90.00
  test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where shift_id = '00000000-0000-0000-0000-000000000083' and valor_devido is null")" = 1
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$immutability_file" >"$failure_log" 2>&1; then
    echo 'divergent/null preflight unexpectedly succeeded' >&2
    exit 1
  fi
  grep -q '23514' "$failure_log"
  grep -qi 'divergente ou nula' "$failure_log"
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000082'")" = 90.00
  test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where shift_id = '00000000-0000-0000-0000-000000000083' and valor_devido is null")" = 1
  test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '00000000-0000-0000-0000-000000000082'")" = 100.00
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
update public.obligations set valor_devido = 100 where shift_id = '00000000-0000-0000-0000-000000000082';
update public.obligations set valor_devido = 100 where shift_id = '00000000-0000-0000-0000-000000000083';
commit;
SQL
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$immutability_file" >/dev/null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$immutability_file" >/dev/null
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000082'")" = 100.00
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000083'")" = 100.00
fi
if [ -n "$authority_file" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000090', 'authenticated', 'authenticated', 'authority-mai65@example.test', 'fixture', now(), now(), now());
insert into public.places (id, user_id, nome)
values ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000090', 'Authority fixture');
insert into public.shifts (id, user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
values ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000091', '2026-03-01', '08:00', '09:00', 100, 'agendado');
update public.shifts set status = 'realizado' where id = '00000000-0000-0000-0000-000000000092';
commit;
SQL
  # O CI aplica toda migration presente no boot; restaura o default Supabase
  # (UPDATE em nivel de tabela) para demonstrar o buraco pre-autoridade de
  # forma deterministica, como papel autenticado com as capacidades do produto.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
grant update on public.shifts to authenticated;
grant update on public.obligations to authenticated;
SQL
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000090', false);
begin;
select set_config('app.saving_shift_obligation_id', '00000000-0000-0000-0000-000000000092', true);
update public.shifts set valor_previsto = 999 where id = '00000000-0000-0000-0000-000000000092';
update public.obligations set valor_devido = 999 where shift_id = '00000000-0000-0000-0000-000000000092';
commit;
reset role;
SQL
  test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '00000000-0000-0000-0000-000000000092'")" = 999.00
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000092'")" = 999.00
  echo 'RED: forged GUC bypass accepted pre-authority (hole demonstrated)'
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000090', false);
select save_shift_with_obligation('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000091', '2026-03-01', '08:00', '09:00', 100, 'realizado', '2026-03-02', '00000000-0000-0000-0000-000000000091', null, null);
reset role;
SQL
  test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '00000000-0000-0000-0000-000000000092'")" = 100.00
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$authority_file" >/dev/null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$authority_file" >/dev/null
  if [ -n "$authority_fix_file" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$authority_fix_file" >/dev/null
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$authority_fix_file" >/dev/null
  fi
  test "$(psql "$DATABASE_URL" -Atqc "select prosecdef from pg_proc where proname = 'save_shift_with_obligation'")" = t
  test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.shifts', 'valor_previsto', 'UPDATE')")" = f
  test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.obligations', 'valor_devido', 'UPDATE')")" = f
  test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.shifts', 'status', 'UPDATE')")" = t
  test "$(psql "$DATABASE_URL" -Atqc "select has_column_privilege('authenticated', 'public.obligations', 'data_prevista', 'UPDATE')")" = t
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<'SQL' >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000090', false);
begin;
select set_config('app.saving_shift_obligation_id', '00000000-0000-0000-0000-000000000092', true);
update public.shifts set valor_previsto = 999 where id = '00000000-0000-0000-0000-000000000092';
update public.obligations set valor_devido = 999 where shift_id = '00000000-0000-0000-0000-000000000092';
commit;
reset role;
SQL
  then
    echo 'forged GUC bypass unexpectedly succeeded post-authority' >&2
    exit 1
  fi
  grep -q '42501' "$failure_log"
  test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '00000000-0000-0000-0000-000000000092'")" = 100.00
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000092'")" = 100.00
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000090', false);
select save_shift_with_obligation('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000091', '2026-03-01', '08:00', '09:00', 120, 'realizado', '2026-03-02', '00000000-0000-0000-0000-000000000091', null, null);
update public.obligations set data_prevista = '2026-03-05' where shift_id = '00000000-0000-0000-0000-000000000092';
reset role;
SQL
  test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '00000000-0000-0000-0000-000000000092'")" = 120.00
  test "$(psql "$DATABASE_URL" -Atqc "select valor_devido from public.obligations where shift_id = '00000000-0000-0000-0000-000000000092'")" = 120.00
  test "$(psql "$DATABASE_URL" -Atqc "select data_prevista from public.obligations where shift_id = '00000000-0000-0000-0000-000000000092'")" = 2026-03-05
  echo 'GREEN: forged bypass denied post-authority, RPC atomic, direct date edit allowed'
fi
echo 'MAI-65 legacy fail-closed, explicit reconciliation, and same-database idempotency passed'
