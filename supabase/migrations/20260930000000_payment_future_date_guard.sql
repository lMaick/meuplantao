-- MAI-140: impedir pagamento recebido (data_pagamento) com data futura.
-- data_prevista permanece intacta (previsao/expectativa). Apenas data_pagamento
-- (recebimento efetivo) e bloqueada acima de hoje no fuso America/Bahia.
-- Defesa em 3 camadas: RPC register_payment, trigger de INSERT direto e
-- view obligations_with_balance (saldo/total recebido ignoram legado futuro).
-- O limite de novos recebimentos (v_registered) soma apenas recebimentos
-- quitados (data <= hoje Bahia), alinhado ao saldo da view: legado futuro,
-- se existir, nao conta como quitado nem consome o limite.

create or replace function public.register_payment(p_obligation_id uuid, p_valor numeric, p_data_pagamento date) returns public.payments language plpgsql security invoker set search_path = public as $$
declare v_payment public.payments; v_obligation public.obligations; v_registered numeric(12,2);
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Autenticacao obrigatoria'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) then raise exception using errcode = '22003', message = 'O pagamento deve ser positivo e ter no maximo duas casas decimais'; end if;
  if p_data_pagamento is null then raise exception using errcode = '23514', message = 'Informe a data do pagamento'; end if;
  if p_data_pagamento > (now() at time zone 'America/Bahia')::date then raise exception using errcode = '23514', message = 'Data de recebimento nao pode ser futura'; end if;
  select * into v_obligation from public.obligations where id = p_obligation_id and user_id = auth.uid() for update;
  if not found then raise exception using errcode = '23503', message = 'Obrigacao nao encontrada'; end if;
  if v_obligation.valor_devido is null then raise exception using errcode = '23514', message = 'Obrigacao ainda nao possui valor devido'; end if;
  select coalesce(sum(valor), 0)::numeric(12,2) into v_registered from public.payments where obligation_id = p_obligation_id and user_id = auth.uid() and status = 'registrado' and data_pagamento <= (now() at time zone 'America/Bahia')::date;
  if v_registered + p_valor > v_obligation.valor_devido then raise exception using errcode = '22003', message = 'O pagamento excede o saldo da obrigacao'; end if;
  insert into public.payments (user_id, obligation_id, valor, data_pagamento, status) values (auth.uid(), p_obligation_id, p_valor, p_data_pagamento, 'registrado') returning * into v_payment;
  return v_payment;
end; $$;

revoke execute on function public.register_payment(uuid, numeric, date) from public, anon;
grant execute on function public.register_payment(uuid, numeric, date) to authenticated;

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
    new.created_at := now();
    if new.status <> 'registrado' then
      raise exception using errcode = '23514', message = 'Novo pagamento deve ser registrado';
    end if;
    if new.valor is null or new.valor <= 0 or new.valor <> round(new.valor, 2) then
      raise exception using errcode = '22003', message = 'O pagamento deve ser positivo e ter no maximo duas casas decimais';
    end if;
    if new.data_pagamento is null then
      raise exception using errcode = '23514', message = 'Informe a data do pagamento';
    end if;
    if new.data_pagamento > (now() at time zone 'America/Bahia')::date then
      raise exception using errcode = '23514', message = 'Data de recebimento nao pode ser futura';
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
       and status = 'registrado'
       and data_pagamento <= (now() at time zone 'America/Bahia')::date;
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

-- Saldo e total recebido derivam apenas de recebimentos quitados (data <= hoje Bahia).
-- Legado futuro/agendado, se existir, nao conta como quitado e nao altera data_prevista.
drop view if exists public.obligations_with_balance;
create view public.obligations_with_balance with (security_invoker = true) as
select o.*, greatest(0, o.valor_devido - coalesce(sum(p.valor) filter (where p.status = 'registrado' and p.data_pagamento <= (now() at time zone 'America/Bahia')::date), 0))::numeric(12,2) as saldo,
  (o.valor_devido is not null and o.valor_devido > coalesce(sum(p.valor) filter (where p.status = 'registrado' and p.data_pagamento <= (now() at time zone 'America/Bahia')::date), 0)
   and o.data_prevista < (now() at time zone 'America/Bahia')::date) as atrasada
from public.obligations o left join public.payments p on p.obligation_id = o.id and p.user_id = o.user_id group by o.id;
