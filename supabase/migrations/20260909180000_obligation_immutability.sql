-- MAI-65 blocker 1: obrigacao de plantao realizado e imutavel fora da RPC
-- financeira e sempre igual ao valor do plantao no boundary PostgreSQL.
-- Migration ADITIVA: nao reescreve a 20260908193728, apenas aperta a trigger
-- validate_obligation_financial_integrity e amplia o preflight legado.
-- Mudanca de valor (valor_devido) ocorre atomicamente via
-- save_shift_with_obligation; edicao direta de data_prevista/responsavel
-- sem tocar no valor continua permitida. Piso >= total pago preservado.

-- Preflight fail-closed: barra realizados ja divergentes ou nulos sem
-- consolidar silenciosamente. Reconciliacao explicita, auditavel e fora da
-- migration, por exemplo via RPC financeira (save_shift_with_obligation)
-- que alinha obligation.valor_devido a shifts.valor_previsto:
--   select o.id, o.valor_devido, s.valor_previsto
--     from public.obligations o join public.shifts s
--       on s.id = o.shift_id and s.user_id = o.user_id
--    where s.status = 'realizado'
--      and (o.valor_devido is null or o.valor_devido is distinct from s.valor_previsto);
--   -- revisar cada linha e corrigir somente pela RPC financeira; reaplicar.
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
      message = 'MAI-65 blocker 1 abortada: existem obrigacoes ligadas a plantao nao realizado; reconcilie os dados legados sem apagar historico e reaplique a migration';
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
      message = 'MAI-65 blocker 1 abortada: existe obrigacao de plantao realizado divergente ou nula; corrija pela RPC financeira sem consolidar silenciosamente e reaplique a migration';
  end if;
end;
$$;

create or replace function public.validate_obligation_financial_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.shifts;
  v_registered numeric(12, 2);
  v_reconciling_shift text := current_setting('app.reconciling_obligation_shift_id', true);
  v_rpc_shift text := current_setting('app.saving_shift_obligation_id', true);
  v_is_rpc boolean;
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

  v_is_rpc := (tg_op <> 'DELETE' and v_rpc_shift is not distinct from new.shift_id::text);

  if tg_op = 'UPDATE' and new.valor_devido is distinct from old.valor_devido and not v_is_rpc then
    raise exception using errcode = '23514', message = 'Altere valor da obrigacao de plantao realizado pela RPC financeira';
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
  if tg_op = 'DELETE' and exists (select 1 from public.shifts where id = old.shift_id and user_id = old.user_id and status = 'realizado')
     and v_reconciling_shift is distinct from old.shift_id::text then
    raise exception using errcode = '23514', message = 'Nao e possivel excluir obrigacao de plantao realizado';
  end if;
  if tg_op = 'UPDATE' and new.valor_devido is not null and new.valor_devido < v_registered then
    raise exception using errcode = '23514', message = 'A alteracao deixaria a obrigacao inconsistente';
  end if;
  return coalesce(new, old);
end;
$$;
