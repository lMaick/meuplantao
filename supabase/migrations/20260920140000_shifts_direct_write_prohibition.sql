-- Migration: Bloquear escrita direta (INSERT e UPDATE) em public.shifts para o papel authenticated
-- Centraliza todas as mutações de criação e edição de plantões exclusivamente na RPC save_shift_with_obligation (SECURITY DEFINER).

-- 1. Revoga privilégios de INSERT e UPDATE na tabela public.shifts
revoke insert on public.shifts from anon, authenticated, public;
revoke update on public.shifts from anon, authenticated, public;

-- 2. Revoga quaisquer privilégios de UPDATE em nível de coluna concedidos anteriormente
revoke update (place_id, data, hora_inicio, hora_fim, status, idempotency_key, updated_at)
  on public.shifts from anon, authenticated, public;

-- 3. Remove policies de escrita direta em public.shifts
drop policy if exists "shifts_insert_own" on public.shifts;
drop policy if exists "shifts_update_own" on public.shifts;

-- 4. Reafirma permissões de leitura (SELECT) e exclusão (DELETE) para authenticated sob RLS
grant select, delete on public.shifts to authenticated;

-- 5. Reafirma concessão de execução da RPC save_shift_with_obligation para authenticated
grant execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) to authenticated;
