#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
migration_file="${1:?migration file is required}"
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
values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000069', '00000000-0000-0000-0000-000000000070', '2026-01-03', '08:00', '09:00', 100, 'realizado');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000069', true);
insert into public.payments (id, user_id, obligation_id, valor, data_pagamento, status)
select '00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000069', o.id, 40, '2026-01-04'::date, 'registrado'
  from public.obligations o where o.shift_id = '00000000-0000-0000-0000-000000000071';
update public.payments set status = 'cancelado' where id = '00000000-0000-0000-0000-000000000073';
update public.shifts set status = 'agendado' where id = '00000000-0000-0000-0000-000000000071';
reset request.jwt.claim.sub;
commit;
SQL

before="$(psql "$DATABASE_URL" -Atqc "select count(*) from public.obligations where id = '00000000-0000-0000-0000-000000000068'")"
test "$before" = 1
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file" >"$failure_log" 2>&1; then
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
echo 'MAI-65 legacy fail-closed, explicit reconciliation, and same-database idempotency passed'
