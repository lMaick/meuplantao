-- Migration: Reconciliacao idempotente de reembolsos e chargebacks (MAI-136)
-- Confirma o achado: antes desta migration, status != approved era ignorado e a
-- vigencia concedida permanecia intacta. Esta migration modela estados de reversao
-- no ledger sem apagar pagamentos, com historico auditavel e recomposicao
-- deterministica da vigencia a partir dos pagamentos ativos remanescentes.
--
-- ORDEM: o timestamp 20260928990000 posiciona esta migration logo apos
-- 20260928210000_subscription_payment_validity_guard.sql e dentro do glob
-- 20260928* movido para o lado no bootstrap legado do job "Supabase real E2E"
-- do CI, de modo que nunca execute antes da criacao de subscription_payments.

-- 1. Colunas de auditoria no ledger (aditivas, sem reescrever historico)
alter table public.subscription_payments
  add column if not exists reversed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- 2. Historico auditavel de transicoes de estado (append-only)
create table if not exists public.subscription_payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mercadopago_payment_id text not null,
  from_status text,
  to_status text not null,
  provider_status text,
  created_at timestamptz not null default now()
);

create index if not exists subscription_payment_events_mp_id_idx
  on public.subscription_payment_events (mercadopago_payment_id);
create index if not exists subscription_payment_events_user_id_idx
  on public.subscription_payment_events (user_id);

alter table public.subscription_payment_events enable row level security;

drop policy if exists "subscription_payment_events_select_own" on public.subscription_payment_events;
create policy "subscription_payment_events_select_own"
  on public.subscription_payment_events for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.subscription_payment_events from anon, authenticated, public;
grant select on public.subscription_payment_events to authenticated;
grant all on public.subscription_payment_events to service_role;

-- 3. RPC de reconciliacao de reversao (somente service_role, SECURITY DEFINER)
-- Regra de recomposicao (documentada em docs/operations/mercadopago-reversals.md):
-- a vigencia e o MAIOR entre:
--   (a) replay cronologico dos pagamentos com status='approved' remanescentes,
--       usando o processed_at original como ancora:
--         cur = null
--         para cada pagamento ativo em ordem de processed_at:
--           se cur e null ou cur <= processed_at: cur = processed_at + validity_days
--           senao: cur = cur + validity_days
--   (b) piso decremental: current_period_end anterior menos os validity_days do
--       pagamento estornado. Preserva vigencia legitima sem lastro modelado no
--       ledger (conta com trial/vigencia anterior ou legado), removendo apenas a
--       contribuicao do pagamento revertido.
-- Status gravado respeita o CHECK subscriptions_status_check
-- ('trialing','active','past_due','canceled','unpaid'): 'active' quando o novo fim
-- e futuro, 'canceled' caso contrario. 'canceled' preserva a semantica de
-- calculateTrial (conta volta ao ciclo natural de trial) e nunca inventa Pro:
-- entitlement continua derivado exclusivamente de current_period_end > now().
-- O rotulo 'expired' e apenas derivado na resposta da RPC, nunca persistido.
-- in_mediation/disputa NAO revoga automaticamente (requer decisao humana).
create or replace function public.reconcile_mercadopago_reversal(
  p_payment_id text,
  p_user_id uuid,
  p_reversal_status text,
  p_months integer default 1,
  p_validity_days integer default 30,
  p_amount numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid text := nullif(trim(coalesce(p_payment_id, '')), '');
  v_reversal text := lower(trim(coalesce(p_reversal_status, '')));
  v_months integer := coalesce(p_months, 1);
  v_validity integer := coalesce(p_validity_days, 30);
  v_now timestamptz := now();
  v_row public.subscription_payments;
  v_current_end timestamptz;
  v_current_status text;
  v_new_end timestamptz;
  v_write_status text;
  v_label text;
  v_active_count integer := 0;
  v_removed_days integer := 0;
  v_rec record;
  v_replay timestamptz := null;
  v_decrement timestamptz := null;
  v_stub_created boolean := false;
begin
  if v_pid is null then
    raise exception using errcode = '22023', message = 'Identificador do pagamento ausente';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Identificador do usuario ausente';
  end if;
  if v_reversal not in ('refunded', 'charged_back') then
    raise exception using errcode = '22023', message = 'Status de reversao invalido (esperado refunded ou charged_back)';
  end if;
  if v_validity <= 0 then
    raise exception using errcode = '22023', message = 'validity_days deve ser maior que zero';
  end if;
  if v_months <= 0 then
    raise exception using errcode = '22023', message = 'months deve ser maior que zero';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select * into v_row from public.subscription_payments
   where mercadopago_payment_id = v_pid for update;

  -- Caso fora de ordem: estorno chegou antes do aprovado (linha inexistente).
  -- Cria stub ja revertido com contribuicao zero para que um evento approved
  -- antigo posterior nao conceda vigencia (ON CONFLICT protege concorrencia).
  -- Se a linha apareceu concorrentemente (approved inserido ao mesmo tempo),
  -- cai no fluxo compartilhado abaixo em vez de retornar not_found.
  if v_row.id is null then
    insert into public.subscription_payments (
      mercadopago_payment_id, user_id, months, validity_days, amount, status,
      processed_at, reversed_at, updated_at
    ) values (
      v_pid, p_user_id, v_months, v_validity, p_amount, v_reversal,
      v_now, v_now, v_now
    )
    on conflict (mercadopago_payment_id) do nothing
    returning * into v_row;

    if v_row.id is null then
      select * into v_row from public.subscription_payments
       where mercadopago_payment_id = v_pid for update;
    else
      v_stub_created := true;
    end if;

    if v_stub_created then
      insert into public.subscription_payment_events (
        user_id, mercadopago_payment_id, from_status, to_status, provider_status
      ) values (
        p_user_id, v_pid, null, v_reversal, v_reversal
      );

      select status, current_period_end into v_current_status, v_current_end
        from public.subscriptions where user_id = p_user_id;

      return jsonb_build_object(
        'reversed', false,
        'already_reversed', false,
        'not_found', true,
        'ownership_mismatch', false,
        'contributed', false,
        'current_period_end', v_current_end,
        'status', case
          when v_current_end is not null and v_current_end > v_now then 'active'
          else coalesce(v_current_status, 'expired')
        end,
        'active_payments', 0,
        'validity_days_removed', 0
      );
    end if;

    if v_row.id is null then
      -- Defensivo: nada a reconciliar e nada foi alterado.
      select status, current_period_end into v_current_status, v_current_end
        from public.subscriptions where user_id = p_user_id;
      return jsonb_build_object(
        'reversed', false,
        'already_reversed', false,
        'not_found', true,
        'ownership_mismatch', false,
        'contributed', false,
        'current_period_end', v_current_end,
        'status', coalesce(v_current_status, 'expired'),
        'active_payments', 0,
        'validity_days_removed', 0
      );
    end if;
    -- Linha concorrente encontrada: segue para ownership/idempotencia/reconciliacao.
  end if;

  -- Ownership: pagamento pertence a outro usuario -> nunca altera entitlement.
  if v_row.user_id <> p_user_id then
    select status, current_period_end into v_current_status, v_current_end
      from public.subscriptions where user_id = p_user_id;
    return jsonb_build_object(
      'reversed', false,
      'already_reversed', false,
      'not_found', false,
      'ownership_mismatch', true,
      'contributed', false,
      'current_period_end', v_current_end,
      'status', coalesce(v_current_status, 'expired'),
      'active_payments', 0,
      'validity_days_removed', 0
    );
  end if;

  -- Idempotencia: repeticao do mesmo estorno ou disputa ja finalizada.
  if v_row.status = v_reversal then
    select status, current_period_end into v_current_status, v_current_end
      from public.subscriptions where user_id = p_user_id;
    return jsonb_build_object(
      'reversed', false,
      'already_reversed', true,
      'not_found', false,
      'ownership_mismatch', false,
      'contributed', false,
      'current_period_end', v_current_end,
      'status', coalesce(v_current_status, 'expired'),
      'active_payments', 0,
      'validity_days_removed', 0
    );
  end if;

  if v_row.status in ('refunded', 'charged_back') then
    select status, current_period_end into v_current_status, v_current_end
      from public.subscriptions where user_id = p_user_id;
    return jsonb_build_object(
      'reversed', false,
      'already_reversed', true,
      'not_found', false,
      'ownership_mismatch', false,
      'contributed', false,
      'current_period_end', v_current_end,
      'status', coalesce(v_current_status, 'expired'),
      'active_payments', 0,
      'validity_days_removed', 0
    );
  end if;

  -- Pagamento nunca contribuiu (ex.: pendente/cancelado antes de aprovar):
  -- apenas registra a transicao, sem recompor vigencia.
  if v_row.status <> 'approved' then
    update public.subscription_payments
       set status = v_reversal, reversed_at = v_now, updated_at = v_now
     where mercadopago_payment_id = v_pid;

    insert into public.subscription_payment_events (
      user_id, mercadopago_payment_id, from_status, to_status, provider_status
    ) values (
      p_user_id, v_pid, v_row.status, v_reversal, v_reversal
    );

    select status, current_period_end into v_current_status, v_current_end
      from public.subscriptions where user_id = p_user_id;
    return jsonb_build_object(
      'reversed', true,
      'already_reversed', false,
      'not_found', false,
      'ownership_mismatch', false,
      'contributed', false,
      'current_period_end', v_current_end,
      'status', coalesce(v_current_status, 'expired'),
      'active_payments', 0,
      'validity_days_removed', 0
    );
  end if;

  -- Transicao approved -> refunded/charged_back: atualiza ledger e recompoe.
  v_removed_days := coalesce(v_row.validity_days, 0);

  update public.subscription_payments
     set status = v_reversal, reversed_at = v_now, updated_at = v_now
   where mercadopago_payment_id = v_pid;

  insert into public.subscription_payment_events (
    user_id, mercadopago_payment_id, from_status, to_status, provider_status
  ) values (
    p_user_id, v_pid, 'approved', v_reversal, v_reversal
  );

  -- Replay dos ativos remanescentes em ordem cronologica.
  for v_rec in
    select validity_days, processed_at
      from public.subscription_payments
     where user_id = p_user_id and status = 'approved'
     order by processed_at asc, created_at asc
  loop
    v_active_count := v_active_count + 1;
    if v_replay is null or v_replay <= v_rec.processed_at then
      v_replay := v_rec.processed_at + (v_rec.validity_days || ' days')::interval;
    else
      v_replay := v_replay + (v_rec.validity_days || ' days')::interval;
    end if;
  end loop;

  select status, current_period_end into v_current_status, v_current_end
    from public.subscriptions where user_id = p_user_id for update;

  -- Piso decremental: preserva lastro sem modelo no ledger (legado/trial
  -- anterior), removendo apenas a contribuicao do pagamento revertido.
  if v_current_end is not null and v_removed_days > 0 then
    v_decrement := v_current_end - (v_removed_days || ' days')::interval;
  end if;

  -- Vigencia recomposta = maior entre replay e piso (ignora nulos).
  v_new_end := v_replay;
  if v_decrement is not null and (v_new_end is null or v_decrement > v_new_end) then
    v_new_end := v_decrement;
  end if;

  -- Escrita restrita ao dominio do CHECK subscriptions_status_check.
  -- Rotulo derivado 'expired' vai so na resposta, nunca no banco.
  if v_new_end is not null and v_new_end > v_now then
    v_write_status := 'active';
    v_label := 'active';
  else
    v_write_status := 'canceled';
    v_label := 'expired';
  end if;

  if v_current_end is not null or v_new_end is not null then
    insert into public.subscriptions (user_id, status, current_period_end, updated_at)
    values (p_user_id, v_write_status, v_new_end, v_now)
    on conflict (user_id) do update set
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object(
    'reversed', true,
    'already_reversed', false,
    'not_found', false,
    'ownership_mismatch', false,
    'contributed', true,
    'current_period_end', v_new_end,
    'status', v_label,
    'active_payments', v_active_count,
    'validity_days_removed', v_removed_days
  );
end;
$$;

revoke execute on function public.reconcile_mercadopago_reversal(text, uuid, text, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.reconcile_mercadopago_reversal(text, uuid, text, integer, integer, numeric) to service_role;
