-- Migration: Reconciliacao idempotente de reembolsos e chargebacks (MAI-136)
-- Confirma o achado: antes desta migration, status != approved era ignorado e a
-- vigencia concedida permanecia intacta. Esta migration modela estados de reversao
-- no ledger sem apagar pagamentos, com historico auditavel e recomposicao
-- deterministica da vigencia a partir dos pagamentos ativos remanescentes.

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
-- a vigencia e recomposta por replay cronologico dos pagamentos com status='approved'
-- remanescentes, usando o processed_at original como ancora:
--   cur = null
--   para cada pagamento ativo em ordem de processed_at:
--     se cur e null ou cur <= processed_at: cur = processed_at + validity_days
--     senao: cur = cur + validity_days
-- Sem ativos remanescentes, a vigencia futura e revogada (teto em now()).
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
  v_new_status text;
  v_active_count integer := 0;
  v_removed_days integer := 0;
  v_rec record;
  v_cur timestamptz := null;
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

    -- Concorrencia: outra transacao inseriu primeiro; recarrega.
    if v_row.id is null then
      select * into v_row from public.subscription_payments
       where mercadopago_payment_id = v_pid for update;
    end if;

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
    if v_cur is null or v_cur <= v_rec.processed_at then
      v_cur := v_rec.processed_at + (v_rec.validity_days || ' days')::interval;
    else
      v_cur := v_cur + (v_rec.validity_days || ' days')::interval;
    end if;
  end loop;

  select status, current_period_end into v_current_status, v_current_end
    from public.subscriptions where user_id = p_user_id for update;

  if v_cur is null then
    -- Sem lastro ativo: revoga vigencia futura (teto em now), preserva passado.
    if v_current_end is not null and v_current_end > v_now then
      v_new_end := v_now;
    else
      v_new_end := v_current_end;
    end if;
    v_new_status := 'expired';
  else
    v_new_end := v_cur;
    v_new_status := case when v_cur > v_now then 'active' else 'expired' end;
  end if;

  if v_current_end is not null or v_new_end is not null then
    insert into public.subscriptions (user_id, status, current_period_end, updated_at)
    values (p_user_id, v_new_status, v_new_end, v_now)
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
    'status', v_new_status,
    'active_payments', v_active_count,
    'validity_days_removed', v_removed_days
  );
end;
$$;

revoke execute on function public.reconcile_mercadopago_reversal(text, uuid, text, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.reconcile_mercadopago_reversal(text, uuid, text, integer, integer, numeric) to service_role;
