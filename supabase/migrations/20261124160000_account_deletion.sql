-- Migration: exclusão definitiva da conta pelo titular (exigência da Google Play).
--
-- Decisões do Maick (24/11/2026): apaga na hora; guarda só o recibo anônimo dos
-- pagamentos de assinatura; quem tem Pro ativo é avisado e pode excluir.
--
-- Exceção ÚNICA à proibição de apagar pagamentos registrados (AGENTS.md,
-- invariante 3). Nenhuma trava financeira foi afrouxada: a função percorre a
-- ordem que as travas existentes já permitem. Só o service_role executa, e a
-- rota do servidor passa sempre o id da sessão autenticada.

-- 1. Recibos sem titular: nenhuma coluna identifica a pessoa.
create table if not exists public.deleted_account_receipts (
  mercadopago_payment_id text primary key,
  amount numeric(10, 2),
  currency text not null default 'BRL',
  months integer not null,
  status text not null,
  paid_at timestamptz not null,
  reversed_at timestamptz,
  archived_at timestamptz not null default now()
);

alter table public.deleted_account_receipts enable row level security;
revoke all on public.deleted_account_receipts from anon, authenticated, service_role, public;
grant select on public.deleted_account_receipts to service_role;
-- Estorno que chega depois da exclusão atualiza só a situação do recibo.
grant update (status, reversed_at) on public.deleted_account_receipts to service_role;

-- 2. Exclusão atômica: ou apaga tudo, ou nada.
create or replace function public.delete_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipts integer;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Identificador do usuario ausente';
  end if;

  -- Mesmo lock das RPCs de billing: nenhum pagamento é processado no meio.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user_id::text));

  -- Bloqueia escritas concorrentes de outra aba (FKs aguardam esta linha).
  perform 1 from auth.users where id = p_user_id for update;
  if not found then
    return jsonb_build_object('deleted', false, 'receipts', 0);
  end if;

  insert into public.deleted_account_receipts (
    mercadopago_payment_id, amount, currency, months, status, paid_at, reversed_at
  )
  select mercadopago_payment_id, amount, currency, months, status, processed_at, reversed_at
    from public.subscription_payments
   where user_id = p_user_id
  on conflict (mercadopago_payment_id) do nothing;
  get diagnostics v_receipts = row_count;

  delete from public.payments where user_id = p_user_id;
  -- Reverter o plantão realizado sem pagamentos remove a obrigação pelo
  -- gatilho existente (shifts_reversal_reconciliation).
  update public.shifts set status = 'cancelado'
   where user_id = p_user_id and status = 'realizado';
  delete from public.obligations where user_id = p_user_id;
  delete from public.shifts where user_id = p_user_id;
  delete from public.places where user_id = p_user_id;
  delete from public.contacts where user_id = p_user_id;

  -- Vestígios fora das FKs com cascade. A quarentena pode ter dinheiro recebido
  -- e não conciliado: fica o registro do pagamento, sem titular.
  update public.subscription_payments_quarantine
     set user_id = null, checkout_id = null, sanitized_payload = '{}'::jsonb
   where user_id = p_user_id;
  delete from public.billing_rate_limits
   where pg_catalog.strpos(bucket_key, p_user_id::text) > 0;

  -- Cascade: perfil, assinatura, pagamentos e eventos, checkouts, avisos,
  -- identidades e sessões de login.
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('deleted', true, 'receipts', v_receipts);
end;
$$;

revoke execute on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;

update public.schema_contract
   set contract_version = '1.2.0',
       description = 'Exclusão de conta pelo titular com recibos anônimos',
       applied_by = current_user,
       updated_at = now()
 where id = 1;
