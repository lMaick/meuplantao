create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_stripe_customer_id_key
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.subscriptions from anon, authenticated, public;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

create or replace function public.set_subscriptions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_subscriptions_updated_at();

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated, public;
grant all on public.stripe_webhook_events to service_role;

create or replace function public.process_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_user_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted public.stripe_webhook_events;
  v_user_id uuid := p_user_id;
begin
  if p_event_type not in (
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ) then
    raise exception using errcode = '22023', message = 'Tipo de evento Stripe nao suportado';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'canceled', 'unpaid') then
    raise exception using errcode = '22023', message = 'Status de assinatura Stripe invalido';
  end if;

  insert into public.stripe_webhook_events (event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing
  returning * into v_inserted;

  if not found then
    return false;
  end if;

  if v_user_id is null then
    select user_id into v_user_id
      from public.subscriptions
     where stripe_subscription_id = p_stripe_subscription_id
        or stripe_customer_id = p_stripe_customer_id
     for update;
  end if;
  if v_user_id is null then
    raise exception using errcode = '23503', message = 'Assinatura Stripe sem usuario associado';
  end if;

  insert into public.subscriptions (
    user_id, status, stripe_customer_id, stripe_subscription_id,
    stripe_price_id, current_period_end, cancel_at_period_end
  ) values (
    v_user_id, p_status, p_stripe_customer_id, p_stripe_subscription_id,
    p_stripe_price_id, p_current_period_end, coalesce(p_cancel_at_period_end, false)
  )
  on conflict (user_id) do update set
    status = excluded.status,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, public.subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.subscriptions.stripe_subscription_id),
    stripe_price_id = coalesce(excluded.stripe_price_id, public.subscriptions.stripe_price_id),
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now();

  return true;
end;
$$;

revoke execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, text, text, timestamptz, boolean) to service_role;
