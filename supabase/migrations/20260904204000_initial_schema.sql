create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  telefone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  endereco text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  telefone text,
  tipo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id uuid not null,
  data date not null,
  hora_inicio time not null,
  hora_fim time not null,
  valor_previsto numeric(12, 2) not null check (valor_previsto >= 0),
  status text not null default 'agendado' check (status in ('agendado', 'realizado', 'cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (place_id, user_id) references public.places (id, user_id) on delete restrict,
  check (hora_fim <> hora_inicio)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  shift_id uuid not null,
  valor numeric(12, 2) not null check (valor > 0),
  data_pagamento date not null,
  status text not null default 'registrado' check (status in ('registrado', 'cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shift_id, user_id) references public.shifts (id, user_id) on delete restrict
);

create index places_user_id_idx on public.places (user_id);
create index contacts_user_id_idx on public.contacts (user_id);
create index shifts_user_id_idx on public.shifts (user_id);
create index shifts_place_id_idx on public.shifts (place_id);
create index payments_user_id_idx on public.payments (user_id);
create index payments_shift_id_idx on public.payments (shift_id);

alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.contacts enable row level security;
alter table public.shifts enable row level security;
alter table public.payments enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profiles_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "places_select_own" on public.places for select to authenticated using ((select auth.uid()) = user_id);
create policy "places_insert_own" on public.places for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "places_update_own" on public.places for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "places_delete_own" on public.places for delete to authenticated using ((select auth.uid()) = user_id);

create policy "contacts_select_own" on public.contacts for select to authenticated using ((select auth.uid()) = user_id);
create policy "contacts_insert_own" on public.contacts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "contacts_update_own" on public.contacts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "contacts_delete_own" on public.contacts for delete to authenticated using ((select auth.uid()) = user_id);

create policy "shifts_select_own" on public.shifts for select to authenticated using ((select auth.uid()) = user_id);
create policy "shifts_insert_own" on public.shifts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "shifts_update_own" on public.shifts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "shifts_delete_own" on public.shifts for delete to authenticated using ((select auth.uid()) = user_id);

create policy "payments_select_own" on public.payments for select to authenticated using ((select auth.uid()) = user_id);
create policy "payments_insert_own" on public.payments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "payments_update_own" on public.payments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "payments_delete_own" on public.payments for delete to authenticated using ((select auth.uid()) = user_id);
