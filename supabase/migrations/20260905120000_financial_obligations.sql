create table public.obligations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
  shift_id uuid not null, valor_devido numeric(12, 2) check (valor_devido is null or valor_devido >= 0),
  data_prevista date not null, responsavel_place_id uuid, responsavel_contact_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (id, user_id), unique (shift_id, user_id),
  foreign key (shift_id, user_id) references public.shifts (id, user_id) on delete restrict,
  foreign key (responsavel_place_id, user_id) references public.places (id, user_id) on delete restrict,
  foreign key (responsavel_contact_id, user_id) references public.contacts (id, user_id) on delete restrict,
  check ((responsavel_place_id is not null) <> (responsavel_contact_id is not null)), check (valor_devido is null or valor_devido = round(valor_devido, 2))
);
insert into public.obligations (user_id, shift_id, valor_devido, data_prevista, responsavel_place_id)
select user_id, id, case when status = 'realizado' then valor_previsto else null end, data, place_id from public.shifts;
alter table public.payments add column obligation_id uuid;
update public.payments p set obligation_id = o.id from public.obligations o where o.shift_id = p.shift_id and o.user_id = p.user_id;
alter table public.payments alter column obligation_id set not null;
alter table public.payments add constraint payments_obligation_fk foreign key (obligation_id, user_id) references public.obligations (id, user_id) on delete restrict;
alter table public.payments drop constraint payments_shift_id_user_id_fkey;
alter table public.payments drop column shift_id;
create index obligations_user_id_idx on public.obligations (user_id);
create index obligations_shift_id_idx on public.obligations (shift_id);
create index payments_obligation_id_idx on public.payments (obligation_id);
alter table public.obligations enable row level security;
create policy "obligations_select_own" on public.obligations for select to authenticated using ((select auth.uid()) = user_id);
create policy "obligations_insert_own" on public.obligations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "obligations_update_own" on public.obligations for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "obligations_delete_own" on public.obligations for delete to authenticated using ((select auth.uid()) = user_id);
create or replace function public.validate_obligation_financial_integrity() returns trigger language plpgsql security invoker set search_path = public as $$
declare v_shift public.shifts; v_registered numeric(12,2);
begin
  if tg_op <> 'DELETE' then
    select * into v_shift from public.shifts where id = new.shift_id and user_id = new.user_id;
    if not found then raise exception using errcode = '23503', message = 'Plantao nao encontrado para este usuario'; end if;
    if v_shift.status = 'realizado' and new.valor_devido is null then raise exception using errcode = '23514', message = 'Obrigacao realizada exige valor devido'; end if;
  end if;
  select coalesce(sum(valor), 0)::numeric(12,2) into v_registered from public.payments where obligation_id = old.id and user_id = old.user_id and status = 'registrado';
  if tg_op = 'DELETE' and v_registered > 0 then raise exception using errcode = '23514', message = 'Nao e possivel excluir obrigacao com pagamentos registrados'; end if;
  if tg_op = 'UPDATE' and new.valor_devido is not null and new.valor_devido < v_registered then raise exception using errcode = '23514', message = 'A alteracao deixaria a obrigacao inconsistente'; end if;
  return coalesce(new, old);
end; $$;
create trigger obligations_financial_integrity before insert or update or delete on public.obligations for each row execute function public.validate_obligation_financial_integrity();
create or replace function public.register_payment(p_obligation_id uuid, p_valor numeric, p_data_pagamento date) returns public.payments language plpgsql security invoker set search_path = public as $$
declare v_payment public.payments; v_obligation public.obligations; v_registered numeric(12,2);
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Autenticacao obrigatoria'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) then raise exception using errcode = '22003', message = 'O pagamento deve ser positivo e ter no maximo duas casas decimais'; end if;
  select * into v_obligation from public.obligations where id = p_obligation_id and user_id = auth.uid() for update;
  if not found then raise exception using errcode = '23503', message = 'Obrigacao nao encontrada'; end if;
  if v_obligation.valor_devido is null then raise exception using errcode = '23514', message = 'Obrigacao ainda nao possui valor devido'; end if;
  select coalesce(sum(valor), 0)::numeric(12,2) into v_registered from public.payments where obligation_id = p_obligation_id and user_id = auth.uid() and status = 'registrado';
  if v_registered + p_valor > v_obligation.valor_devido then raise exception using errcode = '22003', message = 'O pagamento excede o saldo da obrigacao'; end if;
  insert into public.payments (user_id, obligation_id, valor, data_pagamento, status) values (auth.uid(), p_obligation_id, p_valor, p_data_pagamento, 'registrado') returning * into v_payment;
  return v_payment;
end; $$;
drop trigger if exists payments_financial_integrity on public.payments;
create or replace function public.validate_shift_financial_integrity() returns trigger language plpgsql security invoker set search_path = public as $$
declare v_registered numeric(12,2);
begin
  select coalesce(sum(p.valor), 0)::numeric(12,2) into v_registered from public.payments p join public.obligations o on o.id = p.obligation_id where o.shift_id = old.id and p.user_id = old.user_id and p.status = 'registrado';
  if tg_op = 'DELETE' and v_registered > 0 then raise exception using errcode = '23514', message = 'Nao e possivel excluir plantao com pagamentos registrados'; end if;
  if tg_op = 'UPDATE' and new.valor_previsto < v_registered then raise exception using errcode = '23514', message = 'A alteracao deixaria o plantao inconsistente'; end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists shifts_financial_integrity on public.shifts;
create trigger shifts_financial_integrity before update or delete on public.shifts for each row execute function public.validate_shift_financial_integrity();
revoke execute on function public.register_payment(uuid, numeric, date) from public, anon;
grant execute on function public.register_payment(uuid, numeric, date) to authenticated;
create or replace view public.obligations_with_balance with (security_invoker = true) as
select o.*, o.valor_devido - coalesce(sum(p.valor) filter (where p.status = 'registrado'), 0)::numeric(12,2) as saldo,
  (o.valor_devido is not null and o.valor_devido > coalesce(sum(p.valor) filter (where p.status = 'registrado'), 0) and o.data_prevista < current_date) as atrasada
from public.obligations o left join public.payments p on p.obligation_id = o.id and p.user_id = o.user_id group by o.id;
