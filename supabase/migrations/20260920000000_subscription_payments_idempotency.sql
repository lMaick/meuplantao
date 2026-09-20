-- Migration: Subscription payments tracking and idempotency for Mercado Pago
-- Ensures each payment can only extend subscription validity exactly once.

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mercadopago_payment_id text not null unique,
  months integer not null default 1,
  validity_days integer not null default 30,
  amount numeric(10, 2),
  status text not null default 'approved',
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists subscription_payments_user_id_idx
  on public.subscription_payments (user_id);

create unique index if not exists subscription_payments_mp_id_idx
  on public.subscription_payments (mercadopago_payment_id);

alter table public.subscription_payments enable row level security;

drop policy if exists "subscription_payments_select_own" on public.subscription_payments;
create policy "subscription_payments_select_own"
  on public.subscription_payments for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.subscription_payments from anon, authenticated, public;
grant select on public.subscription_payments to authenticated;
grant all on public.subscription_payments to service_role;

-- Atomic RPC to register payment and extend subscription period idempotently
create or replace function public.process_mercadopago_subscription_payment(
  p_payment_id text,
  p_user_id uuid,
  p_months integer,
  p_validity_days integer,
  p_amount numeric,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted public.subscription_payments;
  v_current_period_end timestamptz;
  v_new_period_end timestamptz;
  v_validity_days integer := coalesce(p_validity_days, 30);
  v_months integer := coalesce(p_months, 1);
  v_now timestamptz := now();
begin
  if p_payment_id is null or trim(p_payment_id) = '' then
    raise exception using errcode = '22023', message = 'Identificador do pagamento ausente';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Identificador do usuario ausente';
  end if;

  -- 1. Tenta inserir o registro de pagamento (idempotencia via constraint UNIQUE)
  insert into public.subscription_payments (
    mercadopago_payment_id,
    user_id,
    months,
    validity_days,
    amount,
    status,
    processed_at
  ) values (
    trim(p_payment_id),
    p_user_id,
    v_months,
    v_validity_days,
    p_amount,
    coalesce(p_status, 'approved'),
    v_now
  )
  on conflict (mercadopago_payment_id) do nothing
  returning * into v_inserted;

  -- 2. Se ja foi processado anteriormente, retorna sem adicionar dias
  if v_inserted.id is null then
    select current_period_end into v_current_period_end
      from public.subscriptions
     where user_id = p_user_id;

    return jsonb_build_object(
      'already_processed', true,
      'current_period_end', v_current_period_end,
      'validity_days_added', 0,
      'status', 'active'
    );
  end if;

  -- 3. Pagamento novo: calcula e adiciona vigencia atomicamente
  select current_period_end into v_current_period_end
    from public.subscriptions
   where user_id = p_user_id
   for update;

  if v_current_period_end is not null and v_current_period_end > v_now then
    v_new_period_end := v_current_period_end + (v_validity_days || ' days')::interval;
  else
    v_new_period_end := v_now + (v_validity_days || ' days')::interval;
  end if;

  insert into public.subscriptions (
    user_id,
    status,
    current_period_end,
    updated_at
  ) values (
    p_user_id,
    'active',
    v_new_period_end,
    v_now
  )
  on conflict (user_id) do update set
    status = 'active',
    current_period_end = excluded.current_period_end,
    updated_at = v_now;

  return jsonb_build_object(
    'already_processed', false,
    'current_period_end', v_new_period_end,
    'validity_days_added', v_validity_days,
    'status', 'active'
  );
end;
$$;

revoke execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text) to service_role;
