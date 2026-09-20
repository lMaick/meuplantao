-- Migration: Bloquear escrita direta (INSERT e UPDATE) em public.shifts para o papel authenticated
-- Centraliza todas as mutações de criação e edição de plantões exclusivamente na RPC save_shift_with_obligation (SECURITY DEFINER).

-- 1. Revoga privilégios de INSERT e UPDATE na tabela public.shifts
revoke insert on public.shifts from anon, authenticated, public;
revoke update on public.shifts from anon, authenticated, public;

-- 2. Revoga quaisquer privilégios de UPDATE em nível de coluna concedidos anteriormente
-- Executa de forma condicional/dinâmica para compatibilidade com bancos legados onde idempotency_key pode ainda não existir.
do $$
declare
  v_col text;
begin
  for v_col in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'shifts'
       and column_name in ('place_id', 'data', 'hora_inicio', 'hora_fim', 'status', 'idempotency_key', 'updated_at')
  loop
    execute format('revoke update (%I) on public.shifts from anon, authenticated, public', v_col);
  end loop;
end $$;

-- 3. Remove policies de escrita direta em public.shifts
drop policy if exists "shifts_insert_own" on public.shifts;
drop policy if exists "shifts_update_own" on public.shifts;

-- 4. Reafirma permissões de leitura (SELECT) e exclusão (DELETE) para authenticated sob RLS
grant select, delete on public.shifts to authenticated;

-- 5. Reafirma concessão de execução da RPC save_shift_with_obligation para authenticated
grant execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) to authenticated;

-- 6. Atualiza validate_obligation_financial_integrity para usar FOR KEY SHARE e SECURITY DEFINER
-- Evita exigir privilégio de UPDATE em public.shifts (revogado acima) durante edições legítimas de colunas não financeiras de public.obligations.
create or replace function public.validate_obligation_financial_integrity()
returns trigger
language plpgsql
security definer
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
     for key share;
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

