-- Financial calendar policy: all date-only comparisons use America/Bahia.
-- An obligation dated today is not overdue; it is overdue from tomorrow onward.
create or replace view public.obligations_with_balance with (security_invoker = true) as
select o.*, greatest(0, o.valor_devido - coalesce(sum(p.valor) filter (where p.status = 'registrado'), 0))::numeric(12,2) as saldo,
  (o.valor_devido is not null and o.valor_devido > coalesce(sum(p.valor) filter (where p.status = 'registrado'), 0)
   and o.data_prevista < (now() at time zone 'America/Bahia')::date) as atrasada
from public.obligations o left join public.payments p on p.obligation_id = o.id and p.user_id = o.user_id group by o.id;

create or replace function public.sync_realized_obligation_value()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'realizado' and new.valor_previsto is not null then
    update public.obligations set valor_devido = new.valor_previsto, updated_at = now()
      where shift_id = new.id and user_id = new.user_id;
  end if;
  return new;
end; $$;
drop trigger if exists shifts_realized_obligation_value on public.shifts;
create trigger shifts_realized_obligation_value after update of valor_previsto on public.shifts
for each row execute function public.sync_realized_obligation_value();
