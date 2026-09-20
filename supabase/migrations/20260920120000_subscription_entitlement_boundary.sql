-- Migration: Impor trial de 14 dias e assinatura Pro no boundary do Supabase/PostgreSQL
-- Autoridade final não falsificável para criação e edição de plantões.

-- 1. Helper reutilizável para verificação de entitlement (Trial 14 dias ou Pro ativo)
create or replace function public.has_active_entitlement(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_user_id uuid := coalesce(p_user_id, v_caller_uid);
  v_created_at timestamptz;
  v_current_period_end timestamptz;
  v_now timestamptz := now();
begin
  -- Se nenhum usuário foi informado ou autenticado, não há entitlement
  if v_user_id is null then
    return false;
  end if;

  -- Se chamado no contexto de uma requisição autenticada, impede consultar outro usuário (Scenario E)
  if v_caller_uid is not null and p_user_id is not null and p_user_id <> v_caller_uid then
    return false;
  end if;

  -- 1. Período de Trial: 14 dias a partir de auth.users.created_at
  select created_at into v_created_at
    from auth.users
   where id = v_user_id;

  if v_created_at is not null and v_now < (v_created_at + interval '14 days') then
    return true;
  end if;

  -- 2. Assinatura Pro: vigência real futura em subscriptions.current_period_end
  -- Não confia em status isoladamente; current_period_end futuro é a autoridade estrita
  select current_period_end into v_current_period_end
    from public.subscriptions
   where user_id = v_user_id;

  if v_current_period_end is not null and v_current_period_end > v_now then
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.has_active_entitlement(uuid) from public, anon;
grant execute on function public.has_active_entitlement(uuid) to authenticated, service_role;

-- 2. Atualização da RPC save_shift_with_obligation para validar entitlement no boundary do banco
create or replace function public.save_shift_with_obligation(
  p_shift_id uuid, p_place_id uuid, p_data date, p_hora_inicio time, p_hora_fim time,
  p_valor_previsto numeric, p_status text, p_data_prevista date default null,
  p_responsavel_place_id uuid default null, p_responsavel_contact_id uuid default null,
  p_idempotency_key text default null
) returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts;
  v_obligation public.obligations;
  v_registered numeric(12, 2);
  v_existing_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Autenticacao obrigatoria'; end if;
  if not public.has_active_entitlement(v_user_id) then
    raise exception using errcode = '42501', message = 'Plano Pro ou periodo de testes expirado';
  end if;
  if p_status not in ('agendado', 'realizado', 'cancelado') then raise exception using errcode = '23514', message = 'Status de plantao invalido'; end if;
  if p_hora_fim = p_hora_inicio then raise exception using errcode = '23514', message = 'O horario final deve ser diferente do inicial'; end if;
  if p_status = 'realizado' and (p_valor_previsto is null or p_valor_previsto < 0 or p_valor_previsto <> round(p_valor_previsto, 2)
     or p_data_prevista is null or (p_responsavel_place_id is null) = (p_responsavel_contact_id is null)) then
    raise exception using errcode = '23514', message = 'Plantao realizado exige valor, data prevista e exatamente um responsavel';
  end if;
  if p_status in ('agendado', 'cancelado')
     and (p_data_prevista is not null or p_responsavel_place_id is not null or p_responsavel_contact_id is not null) then
    raise exception using errcode = '23514', message = 'Plantao agendado ou cancelado nao aceita campos de obrigacao financeira';
  end if;
  if p_shift_id is null and p_idempotency_key is not null then
    if length(btrim(p_idempotency_key)) = 0 or length(p_idempotency_key) > 200 then
      raise exception using errcode = '23514', message = 'Chave de idempotencia invalida';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key, 0));
    select id into v_existing_id from public.shifts
      where user_id = v_user_id and idempotency_key = p_idempotency_key for update;
    if found then
      select * into v_shift from public.shifts where id = v_existing_id;
      if v_shift.place_id is distinct from p_place_id or v_shift.data is distinct from p_data
         or v_shift.hora_inicio is distinct from p_hora_inicio or v_shift.hora_fim is distinct from p_hora_fim
         or v_shift.valor_previsto is distinct from p_valor_previsto or v_shift.status is distinct from p_status then
        raise exception using errcode = '23514', message = 'Chave de idempotencia ja usada com payload diferente';
      end if;
      select * into v_obligation from public.obligations where shift_id = v_shift.id and user_id = v_user_id;
      if p_status = 'realizado' and (not found or v_obligation.valor_devido is distinct from p_valor_previsto
         or v_obligation.data_prevista is distinct from p_data_prevista
         or v_obligation.responsavel_place_id is distinct from p_responsavel_place_id
         or v_obligation.responsavel_contact_id is distinct from p_responsavel_contact_id) then
        raise exception using errcode = '23514', message = 'Chave de idempotencia ja usada com obligation diferente';
      end if;
      return v_shift;
    end if;
  end if;
  if p_shift_id is null then
    insert into public.shifts (user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status, idempotency_key)
      values (v_user_id, p_place_id, p_data, p_hora_inicio, p_hora_fim, p_valor_previsto, p_status, p_idempotency_key) returning * into v_shift;
  else
    select * into v_shift from public.shifts where id = p_shift_id and user_id = v_user_id for update;
    if not found then raise exception using errcode = '23503', message = 'Plantao nao encontrado para este usuario'; end if;
    update public.shifts set place_id=p_place_id, data=p_data, hora_inicio=p_hora_inicio, hora_fim=p_hora_fim,
      valor_previsto=p_valor_previsto, status=p_status, updated_at=now()
      where id=p_shift_id and user_id=v_user_id returning * into v_shift;
  end if;
  if p_status = 'realizado' then
    select * into v_obligation from public.obligations where shift_id=v_shift.id and user_id=v_user_id for update;
    if found then
      select coalesce(sum(valor), 0)::numeric(12,2) into v_registered from public.payments
        where obligation_id=v_obligation.id and user_id=v_user_id and status='registrado';
      if p_valor_previsto < v_registered then raise exception using errcode='23514', message='A obrigacao ficaria abaixo do recebido'; end if;
      update public.obligations set valor_devido=p_valor_previsto, data_prevista=p_data_prevista,
        responsavel_place_id=p_responsavel_place_id, responsavel_contact_id=p_responsavel_contact_id, updated_at=now()
        where id=v_obligation.id and user_id=v_user_id;
    else
      insert into public.obligations (user_id, shift_id, valor_devido, data_prevista, responsavel_place_id, responsavel_contact_id)
        values (v_user_id, v_shift.id, p_valor_previsto, p_data_prevista, p_responsavel_place_id, p_responsavel_contact_id);
    end if;
  end if;
  return v_shift;
end;
$$;

revoke execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) from public, anon;
grant execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) to authenticated;

-- 3. Atualização das políticas de RLS em public.shifts para impor entitlement em escritas diretas
drop policy if exists "shifts_insert_own" on public.shifts;
create policy "shifts_insert_own"
  on public.shifts for insert to authenticated
  with check ((select auth.uid()) = user_id and public.has_active_entitlement(user_id));

drop policy if exists "shifts_update_own" on public.shifts;
create policy "shifts_update_own"
  on public.shifts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.has_active_entitlement(user_id));
