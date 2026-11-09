-- Migration: Base do primeiro uso real do produto
--
-- 1. Teste gratuito passa de 14 para 30 dias: repasses costumam vencer depois
--    de 14 dias, então o usuário expirava antes de ver o primeiro atraso.
-- 2. Padrões por local (valor, prazo e responsável) para lançamento rápido.
-- 3. Estado dos avisos por e-mail, acessível só por service_role e RPCs próprias.
-- 4. Contrato semântico do schema sobe para 1.1.0.

-- 1. Trial de 30 dias. O corpo é idêntico ao de 20260920120000, exceto o intervalo.
create or replace function public.has_active_entitlement(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_user_id uuid := coalesce(p_user_id, v_caller_uid);
  v_created_at timestamptz;
  v_current_period_end timestamptz;
  v_now timestamptz := now();
begin
  -- Se nenhum usuário foi informado ou autenticado, não há entitlement
  if v_user_id is null then
    return false;
  end if;

  -- Se chamado no contexto de uma requisição autenticada, impede consultar outro usuário (Scenario E)
  if v_caller_uid is not null and p_user_id is not null and p_user_id <> v_caller_uid then
    return false;
  end if;

  -- 1. Período de Trial: 30 dias a partir de auth.users.created_at
  select created_at into v_created_at
    from auth.users
   where id = v_user_id;

  if v_created_at is not null and v_now < (v_created_at + interval '30 days') then
    return true;
  end if;

  -- 2. Assinatura Pro: vigência real futura em subscriptions.current_period_end
  -- Não confia em status isoladamente; current_period_end futuro é a autoridade estrita
  select current_period_end into v_current_period_end
    from public.subscriptions
   where user_id = v_user_id;

  if v_current_period_end is not null and v_current_period_end > v_now then
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.has_active_entitlement(uuid) from public, anon;
grant execute on function public.has_active_entitlement(uuid) to authenticated, service_role;

-- 2. Padrões por local. Todos opcionais: só pré-preenchem o formulário de plantão,
-- nunca criam obrigação financeira por si só.
alter table public.places
  add column if not exists valor_padrao numeric(12, 2) check (valor_padrao is null or valor_padrao >= 0),
  add column if not exists prazo_recebimento_dias integer
    check (prazo_recebimento_dias is null or prazo_recebimento_dias between 0 and 365),
  add column if not exists responsavel_contact_id uuid;

alter table public.places
  drop constraint if exists places_responsavel_contact_fk;

-- Excluir o contato limpa apenas o padrão, nunca o local nem o user_id.
alter table public.places
  add constraint places_responsavel_contact_fk
  foreign key (responsavel_contact_id, user_id)
  references public.contacts (id, user_id)
  on delete set null (responsavel_contact_id);

create index if not exists places_responsavel_contact_idx
  on public.places (responsavel_contact_id)
  where responsavel_contact_id is not null;

-- 3. Avisos por e-mail. Sem policies: usuário final só acessa via RPC abaixo.
create table if not exists public.email_notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  last_digest_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cada obrigação gera no máximo um aviso de atraso.
create table if not exists public.email_overdue_notices (
  obligation_id uuid primary key references public.obligations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index if not exists email_overdue_notices_user_idx
  on public.email_overdue_notices (user_id);

alter table public.email_notification_settings enable row level security;
alter table public.email_overdue_notices enable row level security;

revoke all on public.email_notification_settings from anon, authenticated, public;
revoke all on public.email_overdue_notices from anon, authenticated, public;
grant select, insert, update on public.email_notification_settings to service_role;
grant select, insert, update on public.email_overdue_notices to service_role;

create or replace function public.get_my_email_alerts_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select enabled into v_enabled
    from public.email_notification_settings
   where user_id = v_uid;

  return coalesce(v_enabled, true);
end;
$$;

create or replace function public.set_my_email_alerts_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'p_enabled is required' using errcode = '22004';
  end if;

  insert into public.email_notification_settings (user_id, enabled)
  values (v_uid, p_enabled)
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        updated_at = now();

  return p_enabled;
end;
$$;

revoke execute on function public.get_my_email_alerts_enabled() from public, anon;
revoke execute on function public.set_my_email_alerts_enabled(boolean) from public, anon;
grant execute on function public.get_my_email_alerts_enabled() to authenticated, service_role;
grant execute on function public.set_my_email_alerts_enabled(boolean) to authenticated, service_role;

-- 4. Contrato semântico.
update public.schema_contract
   set contract_version = '1.1.0',
       description = 'Trial de 30 dias, padrões por local e avisos por e-mail',
       applied_by = current_user,
       updated_at = now()
 where id = 1;
