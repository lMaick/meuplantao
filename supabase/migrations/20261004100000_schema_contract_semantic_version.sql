-- Migration: Marcador canônico de contrato semântico do schema (MAI-158)
--
-- Contexto:
-- Assegura que o release gate prove explicitamente qual versão semântica do
-- schema está instalada em produção, evitando falsos positivos onde RPCs possuem
-- a assinatura de tipos correta mas o corpo interno de migrations anteriores.
--
-- Invariantes:
-- 1. Singleton em public.schema_contract (id = 1 obrigatório).
-- 2. Versão semântica estrita no formato SemVer (MAJOR.MINOR.PATCH).
-- 3. RLS habilitada; acesso exclusivo a migrations e service_role (read-only);
--    anon, authenticated e public não possuem qualquer privilégio.
-- 4. Idempotência estrita: seguro para re-execução em bancos já atualizados.

create table if not exists public.schema_contract (
  id integer primary key default 1 check (id = 1),
  contract_version text not null check (contract_version ~ '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'),
  description text,
  applied_by text not null default current_user,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schema_contract enable row level security;

-- Garantia de segurança: revoga de anon, authenticated e public
revoke all on public.schema_contract from anon, authenticated, public;

-- Concede leitura ao service_role para inspeções e verificações
grant select on public.schema_contract to service_role;

-- Baseline canônico inicial do contrato de produção: 1.0.0 (MAI-158)
insert into public.schema_contract (
  id,
  contract_version,
  description,
  applied_by,
  created_at,
  updated_at
) values (
  1,
  '1.0.0',
  'Baseline do contrato semântico do schema (MAI-158)',
  current_user,
  now(),
  now()
)
on conflict (id) do update set
  contract_version = excluded.contract_version,
  description = excluded.description,
  applied_by = excluded.applied_by,
  updated_at = excluded.updated_at;
