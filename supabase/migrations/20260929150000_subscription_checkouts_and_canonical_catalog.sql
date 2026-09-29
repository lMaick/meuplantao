-- Migration: Subscription checkouts persistence, canonical catalog linking, and quarantine audit trail
-- MAI-137: Previne concessão indevida do plano Pro por divergência de plano, preço, moeda ou identificador de compra.

-- 1. Tabela para registrar intenções de checkout e cotações persistidas no servidor
create table if not exists public.subscription_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null,
  months integer not null,
  validity_days integer not null,
  amount numeric(10, 2) not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  catalog_version text not null default '2026-v1',
  preference_id text,
  init_point text,
  status text not null default 'pending',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days')
);

create index if not exists subscription_checkouts_user_id_idx
  on public.subscription_checkouts (user_id);

create index if not exists subscription_checkouts_preference_id_idx
  on public.subscription_checkouts (preference_id)
  where preference_id is not null;

alter table public.subscription_checkouts enable row level security;

drop policy if exists "subscription_checkouts_select_own" on public.subscription_checkouts;
create policy "subscription_checkouts_select_own"
  on public.subscription_checkouts for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.subscription_checkouts from anon, authenticated, public;
grant select on public.subscription_checkouts to authenticated;
grant all on public.subscription_checkouts to service_role;

-- 2. Tabela de quarentena para pagamentos não vinculados ou com divergências financeiras
create table if not exists public.subscription_payments_quarantine (
  id uuid primary key default gen_random_uuid(),
  mercadopago_payment_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  reason text not null,
  amount numeric(10, 2),
  currency text,
  months integer,
  raw_payload jsonb default '{}'::jsonb,
  status text not null default 'quarantined',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null
);

create index if not exists subscription_payments_quarantine_mp_id_idx
  on public.subscription_payments_quarantine (mercadopago_payment_id);

create index if not exists subscription_payments_quarantine_user_id_idx
  on public.subscription_payments_quarantine (user_id);

alter table public.subscription_payments_quarantine enable row level security;

drop policy if exists "subscription_payments_quarantine_select_own" on public.subscription_payments_quarantine;
create policy "subscription_payments_quarantine_select_own"
  on public.subscription_payments_quarantine for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.subscription_payments_quarantine from anon, authenticated, public;
grant select on public.subscription_payments_quarantine to authenticated;
grant all on public.subscription_payments_quarantine to service_role;

-- 3. Extensão retrocompatível da tabela subscription_payments
alter table public.subscription_payments
  add column if not exists plan_id text,
  add column if not exists currency text not null default 'BRL',
  add column if not exists amount_cents integer,
  add column if not exists checkout_id uuid references public.subscription_checkouts (id) on delete set null,
  add column if not exists catalog_version text;
