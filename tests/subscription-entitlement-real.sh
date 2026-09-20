#!/usr/bin/env bash
# ==============================================================================
# tests/subscription-entitlement-real.sh
# Validação real contra PostgreSQL / Supabase para a migration:
# 20260920120000_subscription_entitlement_boundary.sql
#
# Valida rigorosamente no banco os cenários A, B, C, D, E e F.
# ==============================================================================
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

migration_file="${1:-supabase/migrations/20260920120000_subscription_entitlement_boundary.sql}"
if [ ! -f "$migration_file" ]; then
  echo "Migration file not found: $migration_file" >&2
  exit 1
fi

failure_log="$(mktemp)"
trap 'rm -f "$failure_log"' EXIT

echo "==> Aplicando migration de entitlement boundary..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null

echo "==> Configurando fixtures no Postgres..."
USER_A="00000000-0000-0000-0000-0000000000a1"
USER_B="00000000-0000-0000-0000-0000000000b2"
PLACE_A="00000000-0000-0000-0000-0000000000a2"
PLACE_B="00000000-0000-0000-0000-0000000000b3"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
-- Limpa fixtures anteriores se existirem
delete from public.shifts where user_id in ('$USER_A', '$USER_B');
delete from public.places where user_id in ('$USER_A', '$USER_B');
delete from public.subscriptions where user_id in ('$USER_A', '$USER_B');
delete from auth.users where id in ('$USER_A', '$USER_B');

-- Usuário A: criado há 5 dias (Trial ativo)
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('$USER_A', 'authenticated', 'authenticated', 'user-a-trial@example.test', 'fixture', now(), now() - interval '5 days', now());

-- Usuário B: criado há 30 dias (Trial expirado)
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('$USER_B', 'authenticated', 'authenticated', 'user-b-pro@example.test', 'fixture', now(), now() - interval '30 days', now());

-- Locais
insert into public.places (id, user_id, nome) values ('$PLACE_A', '$USER_A', 'Hospital A');
insert into public.places (id, user_id, nome) values ('$PLACE_B', '$USER_B', 'Hospital B');
commit;
SQL

# ------------------------------------------------------------------------------
# Cenário A: Usuário com 5 dias de conta, sem assinatura -> pode criar plantão
# ------------------------------------------------------------------------------
echo "==> Testando Cenário A: usuário com 5 dias (trial) pode criar plantão..."
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
test "$(psql "$DATABASE_URL" -Atqc "select count(*) from public.shifts where id = '$SHIFT_A' and user_id = '$USER_A'")" = 1
echo "✔ Cenário A aprovado."

# ------------------------------------------------------------------------------
# Cenário B: Usuário com 15 dias, sem assinatura -> RPC rejeita com 42501
# ------------------------------------------------------------------------------
echo "==> Testando Cenário B: usuário com 15 dias sem assinatura é rejeitado..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
update auth.users set created_at = now() - interval '15 days' where id = '$USER_A';
SQL

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select save_shift_with_obligation(
  null,
  '$PLACE_A',
  '2026-09-26'::date,
  '08:00'::time,
  '18:00'::time,
  1300.00,
  'agendado'
);
reset role;
SQL
then
  echo "ERRO: Cenário B deveria ter falhado com 42501 mas teve sucesso!" >&2
  exit 1
fi

grep -q '42501' "$failure_log"
grep -q 'Plano Pro ou periodo de testes expirado' "$failure_log"
echo "✔ Cenário B aprovado (rejeitado com 42501)."

# ------------------------------------------------------------------------------
# Cenário C: Usuário com 30 dias e current_period_end futuro -> pode criar/editar
# ------------------------------------------------------------------------------
echo "==> Testando Cenário C: usuário com 30 dias e Pro ativo pode criar e editar..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
insert into public.subscriptions (user_id, status, current_period_end)
values ('$USER_B', 'active', now() + interval '20 days');
SQL

SHIFT_B="$(psql "$DATABASE_URL" -Atqc "
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_B', false);
-- Criação
select id from save_shift_with_obligation(
  null,
  '$PLACE_B',
  '2026-09-27'::date,
  '07:00'::time,
  '19:00'::time,
  1500.00,
  'agendado'
);
" | tail -n 1)"

test -n "$SHIFT_B"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_B', false);
-- Edição
select save_shift_with_obligation(
  '$SHIFT_B',
  '$PLACE_B',
  '2026-09-27'::date,
  '07:00'::time,
  '19:00'::time,
  1600.00,
  'agendado'
);
reset role;
SQL

test "$(psql "$DATABASE_URL" -Atqc "select valor_previsto from public.shifts where id = '$SHIFT_B'")" = "1600.00"
echo "✔ Cenário C aprovado."

# ------------------------------------------------------------------------------
# Cenário D: status='active', mas current_period_end passado -> rejeita com 42501
# ------------------------------------------------------------------------------
echo "==> Testando Cenário D: status='active' com current_period_end passado é rejeitado..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
update public.subscriptions
   set current_period_end = now() - interval '1 day',
       status = 'active'
 where user_id = '$USER_B';
SQL

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_B', false);
select save_shift_with_obligation(
  null,
  '$PLACE_B',
  '2026-09-28'::date,
  '08:00'::time,
  '18:00'::time,
  1400.00,
  'agendado'
);
reset role;
SQL
then
  echo "ERRO: Cenário D deveria ter falhado com 42501 mas teve sucesso!" >&2
  exit 1
fi

grep -q '42501' "$failure_log"
grep -q 'Plano Pro ou periodo de testes expirado' "$failure_log"
echo "✔ Cenário D aprovado (não confia em status isolado)."

# ------------------------------------------------------------------------------
# Cenário E: Usuário A nunca consegue usar entitlement de Usuário B
# ------------------------------------------------------------------------------
echo "==> Testando Cenário E: isolamento estrito contra uso cruzado de entitlement..."
# Reativa Pro no Usuário B
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
update public.subscriptions
   set current_period_end = now() + interval '20 days'
 where user_id = '$USER_B';
SQL

# Usuário A (expirado) tenta consultar entitlement de B diretamente
user_a_checks_b="$(psql "$DATABASE_URL" -Atqc "
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select public.has_active_entitlement('$USER_B');
" | tail -n 1)"
test "$user_a_checks_b" = "f"

# Usuário A tenta editar o plantão de B
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose <<SQL >"$failure_log" 2>&1
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select save_shift_with_obligation(
  '$SHIFT_B',
  '$PLACE_A',
  '2026-09-27'::date,
  '07:00'::time,
  '19:00'::time,
  9999.00,
  'agendado'
);
reset role;
SQL
then
  echo "ERRO: Usuário A conseguiu chamar save_shift_with_obligation para plantão de B!" >&2
  exit 1
fi

grep -q '42501' "$failure_log"
echo "✔ Cenário E aprovado (isolamento por auth.uid() inviolável)."

# ------------------------------------------------------------------------------
# Cenário F: Leitura do histórico continua funcionando após expiração
# ------------------------------------------------------------------------------
echo "==> Testando Cenário F: leitura do histórico continua funcionando..."
user_a_shifts_count="$(psql "$DATABASE_URL" -Atqc "
set role authenticated;
select set_config('request.jwt.claim.sub', '$USER_A', false);
select count(*) from public.shifts;
" | tail -n 1)"
test "$user_a_shifts_count" = "1"

echo "✔ Cenário F aprovado (leitura via RLS preservada)."

echo "=========================================================================="
echo "TODOS OS CENÁRIOS (A, B, C, D, E, F) VALIDADOS COM SUCESSO NO POSTGRESQL!"
echo "=========================================================================="
