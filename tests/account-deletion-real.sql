-- Validação real da exclusão de conta (public.delete_account).
-- Banco local isolado, com todas as migrations aplicadas. Termina em ROLLBACK.
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/account-deletion-real.sql
begin;

create function pg_temp.must(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FALHOU: %', p_label;
  end if;
end $$;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'del-a@example.test', 'fixture', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'del-b@example.test', 'fixture', now(), now(), now());

-- Mesma massa para A (que exclui) e B (que fica): plantão realizado e pago,
-- plantão agendado, contato padrão no local, Pro pago, checkout e quarentena.
do $$
declare
  v_user uuid;
  v_place uuid;
  v_contact uuid;
  v_shift uuid;
  v_obligation uuid;
  v_checkout uuid;
begin
  foreach v_user in array array[
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    '00000000-0000-0000-0000-0000000000d2'::uuid
  ] loop
    -- Sessão do titular, exigida pela trava de pagamentos (auth.uid()).
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user)::text, true);
    insert into public.profiles (user_id, nome) values (v_user, 'Fixture')
      on conflict (user_id) do nothing;
    insert into public.contacts (user_id, nome) values (v_user, 'Contato') returning id into v_contact;
    insert into public.places (user_id, nome, responsavel_contact_id)
      values (v_user, 'Hospital', v_contact) returning id into v_place;

    insert into public.shifts (user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
      values (v_user, v_place, current_date - 10, '07:00', '19:00', 1500, 'agendado');
    insert into public.shifts (user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
      values (v_user, v_place, current_date - 5, '07:00', '19:00', 2000, 'realizado')
      returning id into v_shift;
    -- A obrigação do plantão realizado nasce pelo gatilho existente.
    select id into strict v_obligation from public.obligations where shift_id = v_shift;
    insert into public.payments (user_id, obligation_id, valor, data_pagamento)
      values (v_user, v_obligation, 800, current_date - 1);
    insert into public.payments (user_id, obligation_id, valor, data_pagamento)
      values (v_user, v_obligation, 100, current_date - 1);
    update public.payments set status = 'cancelado' where obligation_id = v_obligation and valor = 100;
    insert into public.email_overdue_notices (obligation_id, user_id) values (v_obligation, v_user);
    insert into public.email_notification_settings (user_id) values (v_user)
      on conflict (user_id) do nothing;

    insert into public.subscriptions (user_id, status, current_period_end)
      values (v_user, 'active', now() + interval '20 days')
      on conflict (user_id) do nothing;
    insert into public.subscription_checkouts (user_id, plan_id, months, validity_days, amount, amount_cents)
      values (v_user, 'pro', 1, 30, 12.90, 1290) returning id into v_checkout;
    insert into public.subscription_payments (user_id, mercadopago_payment_id, months, amount, checkout_id)
      values (v_user, 'mp-' || v_user, 1, 12.90, v_checkout);
    insert into public.subscription_payment_events (user_id, mercadopago_payment_id, to_status)
      values (v_user, 'mp-' || v_user, 'approved');
    insert into public.subscription_payments_quarantine (mercadopago_payment_id, user_id, checkout_id, reason, sanitized_payload)
      values ('mp-q-' || v_user, v_user, v_checkout, 'fixture', jsonb_build_object('external_reference', v_user));
    insert into public.billing_rate_limits (bucket_key) values ('checkout:user:' || v_user);
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Dispara agora as checagens adiadas da massa, como se já estivesse gravada.
set constraints all immediate;
set constraints all deferred;

create function pg_temp.rows_of(p_user uuid) returns bigint
language plpgsql as $$
declare
  v_table text;
  v_count bigint;
  v_total bigint := 0;
begin
  -- Pelo catálogo: uma tabela nova com user_id entra na checagem sozinha.
  for v_table in
    select c.table_name from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
  loop
    execute format('select count(*) from public.%I where user_id = $1', v_table) into v_count using p_user;
    v_total := v_total + v_count;
  end loop;
  return v_total;
end $$;

create temp table before_b as
  select pg_temp.rows_of('00000000-0000-0000-0000-0000000000d2') as total;
select pg_temp.must((select total from before_b) >= 14, 'massa de teste criada');

-- 1. Usuário comum e visitante não executam a função.
select pg_temp.must(not has_function_privilege('authenticated', 'public.delete_account(uuid)', 'EXECUTE'), 'authenticated sem EXECUTE');
select pg_temp.must(not has_function_privilege('anon', 'public.delete_account(uuid)', 'EXECUTE'), 'anon sem EXECUTE');
select pg_temp.must(has_function_privilege('service_role', 'public.delete_account(uuid)', 'EXECUTE'), 'service_role com EXECUTE');
select pg_temp.must(not has_table_privilege('authenticated', 'public.deleted_account_receipts', 'SELECT'), 'recibos fora do alcance do usuário');
select pg_temp.must(not has_table_privilege('service_role', 'public.deleted_account_receipts', 'DELETE'), 'service_role não apaga recibos');
select pg_temp.must((select relrowsecurity from pg_class where oid = 'public.deleted_account_receipts'::regclass), 'RLS ligada nos recibos');

-- 2. As travas financeiras continuam valendo fora da função.
do $$
begin
  begin
    delete from public.obligations where user_id = '00000000-0000-0000-0000-0000000000d2';
    raise exception 'FALHOU: trava de obrigação com pagamento não disparou';
  exception when check_violation then null;
  end;
end $$;

-- 3. Exclui A, executando como o servidor executa.
set local role service_role;
create temp table outcome as
  select public.delete_account('00000000-0000-0000-0000-0000000000d1') as r;
reset role;
set constraints all immediate;

select pg_temp.must((select (r->>'deleted')::boolean from outcome), 'conta A excluída');
select pg_temp.must((select (r->>'receipts')::int from outcome) = 1, 'um recibo arquivado');
select pg_temp.must(pg_temp.rows_of('00000000-0000-0000-0000-0000000000d1') = 0, 'nenhuma linha de A em tabela nenhuma');
select pg_temp.must(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d1'), 'login de A apagado');
select pg_temp.must(not exists (select 1 from public.billing_rate_limits where strpos(bucket_key, '00000000-0000-0000-0000-0000000000d1') > 0), 'contadores de A apagados');

-- 4. O recibo fica, sem nenhuma coluna que identifique a pessoa.
select pg_temp.must(exists (
  select 1 from public.deleted_account_receipts
   where mercadopago_payment_id = 'mp-00000000-0000-0000-0000-0000000000d1' and amount = 12.90 and months = 1
), 'recibo guardado');
select pg_temp.must(not exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'deleted_account_receipts'
     and column_name ~ '(user|email|nome|telefone|name|phone)'
), 'recibo sem dado pessoal');

select pg_temp.must(exists (
  select 1 from public.subscription_payments_quarantine
   where mercadopago_payment_id = 'mp-q-00000000-0000-0000-0000-0000000000d1'
     and user_id is null and sanitized_payload = '{}'::jsonb
), 'pagamento em quarentena fica sem titular');

-- 5. B continua intacto.
select pg_temp.must(
  pg_temp.rows_of('00000000-0000-0000-0000-0000000000d2') = (select total from before_b),
  'dados de B intactos');
select pg_temp.must(exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d2'), 'login de B intacto');

-- 6. Repetir é inofensivo.
select pg_temp.must(
  not (public.delete_account('00000000-0000-0000-0000-0000000000d1')->>'deleted')::boolean,
  'segunda exclusão não faz nada');

select pg_temp.must((select contract_version from public.schema_contract where id = 1) = '1.2.0', 'contrato 1.2.0');

rollback;
