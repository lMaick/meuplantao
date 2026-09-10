-- MAI-65 autoridade nao falsificavel: a RPC financeira vira SECURITY DEFINER
-- e o papel chamador perde UPDATE direto nas colunas financeiras. Marcadores
-- via current_setting (forjaveis pela sessao) deixam de existir; a autoridade
-- passa a ser privilegio + invariante de estado, sem enfraquecer RLS.
-- Migration ADITIVA: nao reescreve migrations anteriores.
--
-- RLS/ownership preservados: policies por authenticated/auth.uid() continuam
-- ativas para todo acesso direto; dentro da RPC (definer = owner, que desvia
-- RLS por definicao do Postgres) cada leitura/escrita filtra user_id =
-- auth.uid() explicito e a funcao exige autenticacao. Locks (FOR UPDATE/SHARE
-- + advisory da idempotencia), piso >= recebido, rollback, concorrencia e a
-- edicao direta de data_prevista/responsavel seguem intactos.
-- Reversao de realizado sem historico: o BEFORE valida e o AFTER reconcilia
-- (delete apos o shift ja revertido), sem GUC.

do $$
begin
  if exists (
    select 1
      from public.obligations o
      join public.shifts s on s.id = o.shift_id and s.user_id = o.user_id
     where s.status <> 'realizado'
  ) then
    raise exception using
      errcode = '23514',
      message = 'MAI-65 autoridade abortada: existem obrigacoes ligadas a plantao nao realizado; reconcilie os dados legados sem apagar historico e reaplique a migration';
  end if;
  if exists (
    select 1
      from public.obligations o
      join public.shifts s on s.id = o.shift_id and s.user_id = o.user_id
     where s.status = 'realizado'
       and (o.valor_devido is null or o.valor_devido is distinct from s.valor_previsto)
  ) then
    raise exception using
      errcode = '23514',
      message = 'MAI-65 autoridade abortada: existe obrigacao de plantao realizado divergente ou nula; corrija pela RPC financeira sem consolidar silenciosamente e reaplique a migration';
  end if;
end;
$$;

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

-- Colunas financeiras: somente a RPC (definer) escreve. Demais colunas
-- (status, datas, responsaveis) continuam editaveis pelo produto via RLS.
revoke update (valor_previsto) on public.shifts from anon, authenticated, public;
revoke update (valor_devido) on public.obligations from anon, authenticated, public;

create or replace function public.validate_obligation_financial_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.shifts;
  v_registered numeric(12, 2);
begin
  if tg_op = 'UPDATE' and new.shift_id is distinct from old.shift_id then
    raise exception using errcode = '23514', message = 'O plantao da obrigacao nao pode ser alterado';
  end if;

  if tg_op <> 'DELETE' then
    select * into v_shift
      from public.shifts
     where id = new.shift_id
       and user_id = new.user_id
     for share;
    if not found then
      raise exception using errcode = '23503', message = 'Plantao nao encontrado para este usuario';
    end if;
    if v_shift.status <> 'realizado' then
      raise exception using errcode = '23514', message = 'Obrigacao somente pode pertencer a plantao realizado';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    if new.valor_devido is null then
      raise exception using errcode = '23514', message = 'Obrigacao de plantao realizado exige valor_devido nao nulo';
    end if;
    if new.valor_devido is distinct from v_shift.valor_previsto then
      raise exception using errcode = '23514', message = 'Obrigacao divergente do valor do plantao realizado; altere pela RPC financeira';
    end if;
  end if;

  select coalesce(sum(valor), 0)::numeric(12, 2) into v_registered
    from public.payments
   where obligation_id = old.id
     and user_id = old.user_id
     and status = 'registrado';
  if tg_op = 'DELETE' and v_registered > 0 then
    raise exception using errcode = '23514', message = 'Nao e possivel excluir obrigacao com pagamentos registrados';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from public.payments where obligation_id = old.id and user_id = old.user_id) then
    raise exception using errcode = '23514', message = 'Nao e possivel excluir obrigacao com historico de pagamentos';
  end if;
  if tg_op = 'DELETE' and exists (select 1 from public.shifts where id = old.shift_id and user_id = old.user_id and status = 'realizado') then
    raise exception using errcode = '23514', message = 'Nao e possivel excluir obrigacao de plantao realizado';
  end if;
  if tg_op = 'UPDATE' and new.valor_devido is not null and new.valor_devido < v_registered then
    raise exception using errcode = '23514', message = 'A alteracao deixaria a obrigacao inconsistente';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.validate_shift_financial_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_registered numeric(12, 2);
begin
  select coalesce(sum(p.valor), 0)::numeric(12, 2) into v_registered
    from public.payments p
    join public.obligations o on o.id = p.obligation_id
   where o.shift_id = old.id
     and p.user_id = old.user_id
     and p.status = 'registrado';

  if tg_op = 'DELETE' and v_registered > 0 then
    raise exception using errcode = '23514', message = 'Nao e possivel excluir plantao com pagamentos registrados';
  end if;
  if tg_op = 'UPDATE' and new.valor_previsto is not null and new.valor_previsto < v_registered then
    raise exception using errcode = '23514', message = 'A alteracao deixaria o plantao inconsistente';
  end if;
  if tg_op = 'UPDATE' and v_registered > 0 and old.status = 'realizado'
     and new.status in ('agendado', 'cancelado') then
    raise exception using errcode = '23514', message = 'Nao e possivel reverter ou cancelar plantao com pagamentos registrados';
  end if;
  if tg_op = 'UPDATE' and old.status = 'realizado'
     and new.status in ('agendado', 'cancelado')
     and exists (select 1 from public.payments p join public.obligations o on o.id = p.obligation_id where o.shift_id = old.id and p.user_id = old.user_id) then
    raise exception using errcode = '23514', message = 'Nao e possivel reverter plantao com historico de pagamentos';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.reconcile_obligation_on_reversal()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_obligation public.obligations;
begin
  select * into v_obligation from public.obligations where shift_id = old.id and user_id = old.user_id for update;
  if not found then
    return old;
  end if;
  if exists (select 1 from public.payments where obligation_id = v_obligation.id and user_id = old.user_id) then
    raise exception using errcode = '23514', message = 'Nao e possivel reverter plantao com historico de pagamentos';
  end if;
  delete from public.obligations where id = v_obligation.id and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists shifts_reversal_reconciliation on public.shifts;
create trigger shifts_reversal_reconciliation after update of status on public.shifts
for each row when (old.status = 'realizado' and new.status in ('agendado', 'cancelado'))
execute function public.reconcile_obligation_on_reversal();

revoke execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) from public, anon;
grant execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) to authenticated;
