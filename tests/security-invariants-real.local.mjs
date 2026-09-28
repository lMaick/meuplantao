/**
 * MAI-135 — Teste REAL do checker de RLS/grants contra PostgreSQL local.
 *
 * Não usa fixtures: cria papéis/tabelas/policies de verdade, aplica drift
 * temporário via GRANT ... TO PUBLIC, observa o gate falhar e restaura o
 * estado com REVOKE (try/finally) + DROP final de todos os objetos criados.
 *
 * Nenhum ambiente remoto/produção é tocado. Banco alvo:
 *   SECURITY_REAL_DATABASE_URL (default: postgres local na porta 55433)
 * SAFETY GUARD fail-closed: somente hosts locais explícitos (127.0.0.1,
 * localhost, ::1) são aceitos — qualquer outro host aborta ANTES de
 * conectar (ver assertLocalDatabaseUrl). Não há flag que libere remoto.
 * Se o banco estiver inalcançável, o teste é pulado — exceto com
 * SECURITY_REAL_REQUIRE_DB=1, que falha fechado.
 *
 * Execução: npm run test:security-real
 */

import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  checkSecurityInvariantsViaPg,
  assertLocalDatabaseUrl,
} from "../scripts/check-rls-invariants.mjs";

const { Client } = pg;

const DATABASE_URL =
  (process.env.SECURITY_REAL_DATABASE_URL || "").trim() ||
  "postgresql://postgres:postgres@127.0.0.1:55433/postgres";
const REQUIRE_DB = process.env.SECURITY_REAL_REQUIRE_DB === "1";
const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

// SAFETY GUARD (fail-closed): este arquivo é DESTRUTIVO (DROP de tabelas
// public.*, DROP schema auth, DROP roles). Aborta ANTES de qualquer
// conexão/mutação se o host não for local explícito (127.0.0.1, localhost,
// ::1). Não existe flag que libere host remoto.
assertLocalDatabaseUrl(DATABASE_URL);

async function canConnect() {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore
    }
  }
}

const SETUP_SQL = `
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable set search_path = public as $$ select null::uuid $$;
drop table if exists public.payments cascade;
drop table if exists public.obligations cascade;
drop table if exists public.shifts cascade;
drop table if exists public.subscription_payments cascade;
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  place_id uuid,
  data date,
  status text,
  valor_previsto numeric(12, 2),
  idempotency_key text,
  updated_at timestamptz not null default now()
);
create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  mercadopago_payment_id text
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  status text not null default 'registrado'
);
create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  valor_devido numeric(12, 2),
  data_prevista date,
  updated_at timestamptz not null default now()
);
alter table public.shifts enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.payments enable row level security;
alter table public.obligations enable row level security;
drop policy if exists shifts_select_own on public.shifts;
create policy shifts_select_own on public.shifts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists shifts_delete_own on public.shifts;
create policy shifts_delete_own on public.shifts for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists subscription_payments_select_own on public.subscription_payments;
create policy subscription_payments_select_own on public.subscription_payments for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists payments_insert_own on public.payments;
create policy payments_insert_own on public.payments for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists payments_update_own on public.payments;
create policy payments_update_own on public.payments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and status = 'cancelado');
drop policy if exists obligations_select_own on public.obligations;
create policy obligations_select_own on public.obligations for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.shifts from anon, authenticated, public;
grant select, delete on public.shifts to authenticated;
revoke all on public.subscription_payments from anon, authenticated, public;
grant select on public.subscription_payments to authenticated;
grant all on public.subscription_payments to service_role;
revoke all on public.payments from anon, authenticated, public;
grant select, insert, update on public.payments to authenticated;
revoke all on public.obligations from anon, authenticated, public;
grant select on public.obligations to authenticated;
grant update (data_prevista, updated_at) on public.obligations to authenticated;
create or replace function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text)
returns void language plpgsql security definer set search_path = public as $$ begin return; end; $$;
revoke execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) from public, anon;
grant execute on function public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text) to authenticated;
create or replace function public.register_payment(uuid, numeric, date)
returns void language plpgsql security invoker set search_path = public as $$ begin return; end; $$;
revoke execute on function public.register_payment(uuid, numeric, date) from public, anon;
grant execute on function public.register_payment(uuid, numeric, date) to authenticated;
`;

const TEARDOWN_SQL = `
drop function if exists public.save_shift_with_obligation(uuid,uuid,date,time,time,numeric,text,date,uuid,uuid,text);
drop function if exists public.register_payment(uuid, numeric, date);
drop table if exists public.payments cascade;
drop table if exists public.obligations cascade;
drop table if exists public.shifts cascade;
drop table if exists public.subscription_payments cascade;
drop schema if exists auth cascade;
drop role if exists authenticated;
drop role if exists anon;
drop role if exists service_role;
`;

const ready = await canConnect();
if (!ready && REQUIRE_DB) {
  throw new Error(`[security-real] Banco local inalcançável em ${DATABASE_URL.replace(/:[^:@]+@/, ":[REDACTED]@")} (SECURITY_REAL_REQUIRE_DB=1)`);
}

test("security-real: gate passa no estado íntegro e falha sob drift PUBLIC com restauração", { skip: !ready && "banco local indisponível" }, async () => {
  const admin = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000 });
  await admin.connect();
  try {
    await admin.query(SETUP_SQL);

    const baseline = await checkSecurityInvariantsViaPg(DATABASE_URL, { logger: SILENT });
    assert.strictEqual(baseline.ok, true, `baseline íntegro deve passar: ${JSON.stringify(baseline.failures || baseline.error)}`);

    const scenarios = [
      {
        grant: "grant insert on public.shifts to public",
        revoke: "revoke insert on public.shifts from public",
        checkId: "shifts.no_insert_authenticated",
        label: "PUBLIC INSERT em shifts",
      },
      {
        grant: "grant update on public.shifts to public",
        revoke: "revoke update on public.shifts from public",
        checkId: "shifts.no_update_authenticated",
        label: "PUBLIC UPDATE em shifts",
      },
      {
        grant: "grant insert on public.subscription_payments to public",
        revoke: "revoke insert on public.subscription_payments from public",
        checkId: "subscription_payments.no_write_authenticated",
        label: "PUBLIC INSERT em subscription_payments",
      },
      {
        grant: "grant update (valor_devido) on public.obligations to public",
        revoke: "revoke update (valor_devido) on public.obligations from public",
        checkId: "obligations.no_financial_update",
        label: "PUBLIC UPDATE em obligations.valor_devido",
      },
    ];

    for (const s of scenarios) {
      await admin.query(s.grant);
      try {
        const drifted = await checkSecurityInvariantsViaPg(DATABASE_URL, { logger: SILENT });
        assert.strictEqual(drifted.ok, false, `${s.label} deve falhar o gate`);
        const check = (drifted.checks || []).find((c) => c.id === s.checkId);
        assert.ok(check, `check ${s.checkId} deve existir`);
        assert.strictEqual(check.status, "FAIL", `${s.label} deve reprovar ${s.checkId}`);
      } finally {
        await admin.query(s.revoke);
      }
      const restored = await checkSecurityInvariantsViaPg(DATABASE_URL, { logger: SILENT });
      assert.strictEqual(restored.ok, true, `após REVOKE (${s.label}) o gate deve voltar a passar`);
    }
  } finally {
    try {
      await admin.query(TEARDOWN_SQL);
    } finally {
      await admin.end();
    }
  }
});
