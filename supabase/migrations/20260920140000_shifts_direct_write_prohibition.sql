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
  v_role text;
begin
  for v_col in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'shifts'
       and column_name in ('place_id', 'data', 'hora_inicio', 'hora_fim', 'status', 'idempotency_key', 'updated_at')
  loop
    for v_role in select unnest(array['anon', 'authenticated', 'public'])
    loop
      execute format('revoke update (%I) on public.shifts from %I', v_col, v_role);
    end loop;
  end loop;
end $$;

-- 3. Remove policies de escrita direta em public.shifts
drop policy if exists "shifts_insert_own" on public.shifts;
drop policy if exists "shifts_update_own" on public.shifts;

-- 4. Reafirma permissões de leitura (SELECT) e exclusão (DELETE) para authenticated sob RLS
grant select, delete on public.shifts to authenticated;

-- 5. Reafirma concessão de execução da RPC save_shift_with_obligation para authenticated
do $$
declare
  v_rec record;
begin
  for v_rec in
    select p.oid::regprocedure as regproc
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'save_shift_with_obligation'
  loop
    execute format('grant execute on function %s to authenticated', v_rec.regproc);
  end loop;
end $$;

