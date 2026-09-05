create or replace function public.register_payment(p_shift_id uuid, p_valor numeric, p_data_pagamento date)
returns public.payments language plpgsql security invoker set search_path = public as $$
declare v_payment public.payments;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Autenticação obrigatória'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) then
    raise exception using errcode = '22003', message = 'O pagamento deve ser positivo e ter no máximo duas casas decimais';
  end if;
  insert into public.payments (user_id, shift_id, valor, data_pagamento, status)
    values (auth.uid(), p_shift_id, p_valor, p_data_pagamento, 'registrado') returning * into v_payment;
  return v_payment;
end; $$;

create or replace function public.validate_payment_financial_integrity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_shift public.shifts; v_registered numeric(12,2);
begin
  if new.status = 'registrado' then
    select * into v_shift from public.shifts where id = new.shift_id and user_id = new.user_id for update;
    if not found then raise exception using errcode = '23503', message = 'Plantão não encontrado para este usuário'; end if;
    if v_shift.status <> 'realizado' then raise exception using errcode = '23514', message = 'Só é possível registrar pagamento de plantão realizado'; end if;
    select coalesce(sum(valor), 0)::numeric(12,2) into v_registered from public.payments
      where shift_id = new.shift_id and user_id = new.user_id and status = 'registrado'
        and (tg_op <> 'UPDATE' or id <> new.id);
    if v_registered + new.valor > v_shift.valor_previsto then
      raise exception using errcode = '22003', message = 'O pagamento excede o saldo do plantão';
    end if;
  end if;
  return new;
end; $$;

create or replace function public.validate_shift_financial_integrity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_registered numeric(12,2);
begin
  select coalesce(sum(valor), 0)::numeric(12,2) into v_registered from public.payments
    where shift_id = old.id and user_id = old.user_id and status = 'registrado';
  if tg_op = 'DELETE' and v_registered > 0 then
    raise exception using errcode = '23514', message = 'Não é possível excluir plantão com pagamentos registrados';
  end if;
  if tg_op = 'UPDATE' and ((new.status = 'cancelado' and v_registered > 0) or new.valor_previsto < v_registered) then
    raise exception using errcode = '23514', message = 'A alteração deixaria o plantão com saldo financeiro inconsistente';
  end if;
  return coalesce(new, old);
end; $$;

drop trigger if exists payments_financial_integrity on public.payments;
create trigger payments_financial_integrity before insert or update on public.payments for each row execute function public.validate_payment_financial_integrity();
drop trigger if exists shifts_financial_integrity on public.shifts;
create trigger shifts_financial_integrity before update or delete on public.shifts for each row execute function public.validate_shift_financial_integrity();
revoke execute on function public.register_payment(uuid, numeric, date) from public, anon;
grant execute on function public.register_payment(uuid, numeric, date) to authenticated;
