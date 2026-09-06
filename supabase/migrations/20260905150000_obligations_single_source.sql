-- Financial policy: dates are calendar dates in the user's America/Bahia timezone.
-- An obligation becomes overdue only on the day after data_prevista; the view
-- uses the database current_date (UTC calendar) as the stable server rule.

create or replace function public.ensure_realized_obligation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'realizado' then
    if new.valor_previsto is null or new.valor_previsto < 0 then
      raise exception using errcode = '23514', message = 'Plantao realizado exige valor valido';
    end if;
    insert into public.obligations (user_id, shift_id, valor_devido, data_prevista, responsavel_place_id)
      values (new.user_id, new.id, new.valor_previsto, new.data, new.place_id)
    on conflict (shift_id, user_id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists shifts_realized_obligation on public.shifts;
create trigger shifts_realized_obligation after insert or update of status on public.shifts
for each row execute function public.ensure_realized_obligation();

create or replace function public.validate_realized_obligation()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_obligation public.obligations;
begin
  if new.status = 'realizado' then
    select * into v_obligation from public.obligations where shift_id = new.id and user_id = new.user_id;
    if not found or v_obligation.valor_devido is null or v_obligation.data_prevista is null
       or (v_obligation.responsavel_place_id is null and v_obligation.responsavel_contact_id is null) then
      raise exception using errcode = '23514', message = 'Plantao realizado exige exatamente uma obrigacao financeira completa';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists shifts_realized_obligation_valid on public.shifts;
create constraint trigger shifts_realized_obligation_valid after insert or update on public.shifts
deferrable initially deferred for each row execute function public.validate_realized_obligation();

create or replace function public.validate_shift_financial_integrity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_registered numeric(12,2); v_obligation public.obligations;
begin
  select coalesce(sum(p.valor), 0)::numeric(12,2) into v_registered
    from public.payments p join public.obligations o on o.id = p.obligation_id
    where o.shift_id = old.id and p.user_id = old.user_id and p.status = 'registrado';
  if tg_op = 'DELETE' and v_registered > 0 then raise exception using errcode = '23514', message = 'Nao e possivel excluir plantao com pagamentos registrados'; end if;
  if tg_op = 'UPDATE' and v_registered > 0 and old.status = 'realizado' and new.status in ('agendado','cancelado') then raise exception using errcode = '23514', message = 'Nao e possivel reverter ou cancelar plantao com pagamentos registrados'; end if;
  if tg_op = 'UPDATE' and new.status = 'realizado' and (new.valor_previsto is null or new.valor_previsto < 0) then raise exception using errcode = '23514', message = 'Plantao realizado exige valor valido'; end if;
  if tg_op = 'UPDATE' and new.status = 'realizado' then
    select * into v_obligation from public.obligations where shift_id = old.id and user_id = old.user_id;
    if found and v_registered > coalesce(v_obligation.valor_devido, 0) then raise exception using errcode = '23514', message = 'A obrigacao ficaria abaixo do recebido'; end if;
  end if;
  return coalesce(new, old);
end; $$;

create or replace view public.obligations_with_balance with (security_invoker = true) as
select o.*, greatest(0, o.valor_devido - coalesce(sum(p.valor) filter (where p.status = 'registrado'), 0))::numeric(12,2) as saldo,
  (o.valor_devido is not null and o.valor_devido > coalesce(sum(p.valor) filter (where p.status = 'registrado'), 0) and o.data_prevista < current_date) as atrasada
from public.obligations o left join public.payments p on p.obligation_id = o.id and p.user_id = o.user_id group by o.id;
