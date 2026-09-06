-- Payments are immutable financial records. The only supported mutation is a
-- logical cancellation of a registered payment.
create or replace function public.validate_payment_financial_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_obligation public.obligations;
  v_shift public.shifts;
  v_registered numeric(12, 2);
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Operacao de pagamento nao autorizada';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'registrado' then
      raise exception using errcode = '23514', message = 'Novo pagamento deve ser registrado';
    end if;
    if new.valor is null or new.valor <= 0 or new.valor <> round(new.valor, 2) then
      raise exception using errcode = '22003', message = 'O pagamento deve ser positivo e ter no maximo duas casas decimais';
    end if;
  else
    if new.user_id is distinct from old.user_id
       or new.obligation_id is distinct from old.obligation_id
       or new.valor is distinct from old.valor
       or new.data_pagamento is distinct from old.data_pagamento
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '23514', message = 'Pagamentos nao podem ser editados';
    end if;
    if old.status = 'cancelado' or new.status <> 'cancelado' then
      raise exception using errcode = '23514', message = 'Somente pagamentos registrados podem ser cancelados';
    end if;
  end if;

  -- Every write locks the obligation. This serializes direct INSERTs and the
  -- register_payment RPC on the same balance, including concurrent sessions.
  select * into v_obligation
    from public.obligations
   where id = new.obligation_id and user_id = new.user_id
   for update;
  if not found then
    raise exception using errcode = '23503', message = 'Obrigacao nao encontrada para este usuario';
  end if;

  select * into v_shift
    from public.shifts
   where id = v_obligation.shift_id and user_id = v_obligation.user_id;
  if not found or v_shift.status <> 'realizado' then
    raise exception using errcode = '23514', message = 'So e possivel registrar pagamento de plantao realizado';
  end if;

  if tg_op = 'INSERT' then
    select coalesce(sum(valor), 0)::numeric(12, 2) into v_registered
      from public.payments
     where obligation_id = new.obligation_id
       and user_id = new.user_id
       and status = 'registrado';
    if v_obligation.valor_devido is null or v_registered + new.valor > v_obligation.valor_devido then
      raise exception using errcode = '22003', message = 'O pagamento excede o saldo da obrigacao';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payments_financial_integrity on public.payments;
create trigger payments_financial_integrity
before insert or update on public.payments
for each row execute function public.validate_payment_financial_integrity();

-- Keep the existing owner policy and make the allowed UPDATE contract explicit.
drop policy if exists "payments_update_own" on public.payments;
create policy "payments_update_own" on public.payments
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id and status = 'cancelado');
