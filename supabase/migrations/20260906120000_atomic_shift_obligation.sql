-- MAI-57: atomic shift and realized obligation write. This is security invoker;
-- table RLS and ownership foreign keys remain active for every statement.
create or replace function public.save_shift_with_obligation(
  p_shift_id uuid, p_place_id uuid, p_data date, p_hora_inicio time, p_hora_fim time,
  p_valor_previsto numeric, p_status text, p_data_prevista date default null,
  p_responsavel_place_id uuid default null, p_responsavel_contact_id uuid default null
) returns public.shifts language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid := auth.uid(); v_shift public.shifts; v_obligation public.obligations;
  v_registered numeric(12, 2);
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Autenticacao obrigatoria'; end if;
  if p_status not in ('agendado', 'realizado', 'cancelado') then raise exception using errcode = '23514', message = 'Status de plantao invalido'; end if;
  if p_hora_fim = p_hora_inicio then raise exception using errcode = '23514', message = 'O horario final deve ser diferente do inicial'; end if;
  if p_status = 'realizado' and (p_valor_previsto is null or p_valor_previsto < 0 or p_valor_previsto <> round(p_valor_previsto, 2)
     or p_data_prevista is null or (p_responsavel_place_id is null) = (p_responsavel_contact_id is null)) then
    raise exception using errcode = '23514', message = 'Plantao realizado exige valor, data prevista e exatamente um responsavel';
  end if;
  if p_shift_id is null then
    insert into public.shifts (user_id, place_id, data, hora_inicio, hora_fim, valor_previsto, status)
      values (v_user_id, p_place_id, p_data, p_hora_inicio, p_hora_fim, p_valor_previsto, p_status) returning * into v_shift;
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
end; $$;
revoke execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid) from public, anon;
grant execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid) to authenticated;
