/* MAI-140 — prova de execução REAL da migration guard no PostgreSQL 16 (docker).
 *
 * Execução:  node --experimental-strip-types tests/payment-future-date-real-pg.real.mjs
 * (fora do `npm test`; exige Docker local. Sobe postgres:16 efêmero, sem segredos.)
 *
 * O teste aplica o CONTEÚDO EXATO de
 * supabase/migrations/20260930000000_payment_future_date_guard.sql e executa
 * chamadas reais: register_payment com data futura/hoje/passada, INSERT direto,
 * expressão de fuso America/Bahia, view obligations_with_balance e cenário de
 * legado futuro (trigger desabilitado para simular linha pré-guard).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260930000000_payment_future_date_guard.sql");
const DOCKER = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const CONTAINER = "mai140-pg-guard";
const PORT = "55433";
const PASSWORD = "mai140-test-only";
const USER_ID = "11111111-1111-4111-8111-111111111111";

const docker = (...args) => execFileSync(DOCKER, args, { stdio: "pipe" }).toString();
const bahiaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());
const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);
};

let client;
let obligationId;

before(async () => {
  try {
    docker("rm", "-f", CONTAINER);
  } catch { /* sem container anterior */ }
  docker(
    "run", "-d", "--rm", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${PASSWORD}`,
    "-p", `${PORT}:5432`,
    "postgres:16",
  );
  client = new Client({ host: "127.0.0.1", port: Number(PORT), user: "postgres", password: PASSWORD, database: "postgres" });
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await client.connect();
      break;
    } catch (err) {
      await client.end().catch(() => {});
      client = new Client({ host: "127.0.0.1", port: Number(PORT), user: "postgres", password: PASSWORD, database: "postgres" });
      if (Date.now() > deadline) throw new Error(`Postgres efêmero não subiu: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await client.query(`create role anon nologin; create role authenticated nologin;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id) values ('${USER_ID}') on conflict do nothing;
    create or replace function auth.uid() returns uuid language sql stable as $$ select '${USER_ID}'::uuid $$;
    create table if not exists public.shifts (id uuid primary key, user_id uuid not null, status text not null);
    create table if not exists public.obligations (id uuid primary key, user_id uuid not null, shift_id uuid not null, valor_devido numeric(12,2), data_prevista date not null);
    create table if not exists public.payments (id uuid primary key default gen_random_uuid(), user_id uuid not null, obligation_id uuid not null, valor numeric(12,2) not null, data_pagamento date not null, status text not null default 'registrado', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create extension if not exists "pgcrypto";`);
  await client.query(fs.readFileSync(MIGRATION, "utf8"));
  const shift = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  obligationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await client.query(`insert into public.shifts (id, user_id, status) values ('${shift}', '${USER_ID}', 'realizado');
    insert into public.obligations (id, user_id, shift_id, valor_devido, data_prevista) values ('${obligationId}', '${USER_ID}', '${shift}', 1000.00, (now() at time zone 'America/Bahia')::date);`);
});

after(async () => {
  await client?.end().catch(() => {});
  try {
    docker("rm", "-f", CONTAINER);
  } catch { /* limpeza best-effort */ }
});

const rpc = (valor, data) =>
  client.query(`select * from public.register_payment('${obligationId}', ${valor}, '${data}')`);

describe("MAI-140 real PG: register_payment x data futura (America/Bahia)", () => {
  test("base limpa: contagem de recebimentos futuros existentes = 0", async () => {
    const { rows } = await client.query(
      `select count(*)::int as n from public.payments where status = 'registrado' and data_pagamento > (now() at time zone 'America/Bahia')::date`,
    );
    assert.equal(rows[0].n, 0);
  });

  test("escrita via RPC com data futura falha (23514)", async () => {
    const future = addDays(bahiaToday(), 1);
    await assert.rejects(rpc(100, future), (err) => {
      assert.equal(err.code, "23514");
      assert.match(err.message, /futura/);
      return true;
    });
  });

  test("RPC aceita hoje e passado; parciais 400 + 600 quitam e zeram o saldo da view", async () => {
    const today = bahiaToday();
    const past = addDays(today, -5);
    await rpc(400, past);
    await rpc(600, today);
    const { rows } = await client.query(`select saldo, atrasada from public.obligations_with_balance where id = '${obligationId}'`);
    assert.equal(Number(rows[0].saldo), 0);
  });

  test("INSERT direto com data futura falha no trigger (23514)", async () => {
    const future = addDays(bahiaToday(), 2);
    await assert.rejects(
      client.query(`insert into public.payments (user_id, obligation_id, valor, data_pagamento, status) values ('${USER_ID}', '${obligationId}', 10, '${future}', 'registrado')`),
      (err) => {
        assert.equal(err.code, "23514");
        assert.match(err.message, /futura/);
        return true;
      },
    );
  });

  test("virada de fuso: expressão America/Bahia do guard avalia o dia correto", async () => {
    const { rows } = await client.query(`select
      ('2026-09-16T02:59:00Z'::timestamptz at time zone 'America/Bahia')::date as antes,
      ('2026-09-16T03:00:00Z'::timestamptz at time zone 'America/Bahia')::date as depois`);
    assert.equal(rows[0].antes.toISOString().slice(0, 10), "2026-09-15");
    assert.equal(rows[0].depois.toISOString().slice(0, 10), "2026-09-16");
  });

  test("legado futuro: view nao conta como quitado; limite alinhado; contagem detecta 1", async () => {
    const shift2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const obl2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const future = addDays(bahiaToday(), 3);
    await client.query(`insert into public.shifts (id, user_id, status) values ('${shift2}', '${USER_ID}', 'realizado');
      insert into public.obligations (id, user_id, shift_id, valor_devido, data_prevista) values ('${obl2}', '${USER_ID}', '${shift2}', 1200.00, (now() at time zone 'America/Bahia')::date);
      alter table public.payments disable trigger payments_financial_integrity;
      insert into public.payments (user_id, obligation_id, valor, data_pagamento, status) values ('${USER_ID}', '${obl2}', 1200.00, '${future}', 'registrado');
      alter table public.payments enable trigger payments_financial_integrity;`);
    const view = await client.query(`select saldo from public.obligations_with_balance where id = '${obl2}'`);
    assert.equal(Number(view.rows[0].saldo), 1200.0, "legado futuro nao abate o saldo");
    const count = await client.query(
      `select count(*)::int as n from public.payments where status = 'registrado' and data_pagamento > (now() at time zone 'America/Bahia')::date`,
    );
    assert.equal(count.rows[0].n, 1, "query de contagem detecta o legado futuro");
    // Limite alinhado ao saldo: novo recebimento quitado de 1200 ainda cabe.
    await client.query(`select * from public.register_payment('${obl2}', 1200.00, '${bahiaToday()}')`);
    const settled = await client.query(`select saldo from public.obligations_with_balance where id = '${obl2}'`);
    assert.equal(Number(settled.rows[0].saldo), 0);
  });
});
