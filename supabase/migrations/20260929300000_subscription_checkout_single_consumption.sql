-- Migration: Consumo unico de cotacao de checkout (MAI-147)
-- Dois payment IDs concorrentes nao podem conceder Pro sobre a mesma cotacao.
-- A associacao checkout <-> payment ID ocorre atomicamente dentro da transacao
-- que concede vigencia (constraint/CAS + idempotencia por payment ID).
--
-- ORDEM (MAI-147): terceira migration do bloco de billing, apos
--   20260929150000_subscription_checkouts_and_canonical_catalog.sql (cotacoes) e
--   20260929200000_subscription_reversal_reconciliation.sql (reversoes).
-- Estende public.process_mercadopago_subscription_payment (definida em
-- 20260928210000_subscription_payment_validity_guard.sql) com o parametro
-- opcional p_checkout_id (default null => chamadas antigas com 6 args seguem
-- validas). Semantica de vigencia/idempotencia preservada; adiciona apenas o
-- claim atomico da cotacao.

-- 1. Colunas de conclusao da cotacao (idempotente; 2915 ja as cria, reforco defensivo)
alter table public.subscription_checkouts
  add column if not exists completed_payment_id text,
  add column if not exists completed_at timestamptz;

-- 2. Idempotencia por payment ID: o mesmo pagamento nunca consome duas cotacoes distintas
create unique index if not exists subscription_checkouts_completed_payment_id_key
  on public.subscription_checkouts (completed_payment_id)
  where completed_payment_id is not null;

-- 3. Lookup reverso pagamento -> cotacao no ledger
create index if not exists subscription_payments_checkout_id_idx
  on public.subscription_payments (checkout_id)
  where checkout_id is not null;

-- 4. RPC estendida com claim atomico da cotacao (somente service_role, SECURITY DEFINER)
-- Contrato:
--   - p_checkout_id null => comportamento identico ao validity_guard (sem claim).
--   - p_checkout_id informado => lock da cotacao (FOR UPDATE), fail-closed se:
--       cotacao inexistente, de outro usuario, expirada ou ja consumida por
--       payment ID diferente (errcode 23505, mensagem 'Cotacao ja consumida').
--   - Marcar completed apos a RPC, em chamada separada, NAO basta (condicao de
--     corrida); a marcacao ocorre nesta mesma transacao, apos o upsert de vigencia.
create or replace function public.process_mercadopago_subscription_payment(
  p_payment_id text,
  p_user_id uuid,
  p_months integer,
  p_validity_days integer,
  p_amount numeric,
  p_status text,
  p_checkout_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid text := nullif(trim(coalesce(p_payment_id, '')), '');
  v_inserted public.subscription_payments;
  v_current_period_end timestamptz;
  v_current_status text;
  v_new_period_end timestamptz;
  v_real_status text;
  v_validity_days integer := coalesce(p_validity_days, 30);
  v_months integer := coalesce(p_months, 1);
  v_now timestamptz := now();
  v_checkout public.subscription_checkouts;
begin
  -- 1. Validacoes de entrada (boundary estrito — fail-closed)
  if v_pid is null then
    raise exception using errcode = '22023', message = 'Identificador do pagamento ausente';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Identificador do usuario ausente';
  end if;
  if v_validity_days <= 0 then
    raise exception using errcode = '22023',
      message = 'validity_days deve ser maior que zero';
  end if;
  if v_months <= 0 then
    raise exception using errcode = '22023',
      message = 'months deve ser maior que zero';
  end if;

  -- 2. Serializacao estrita por usuario via advisory lock de transacao
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- 3. Claim atomico da cotacao (CAS sob lock): duas transacoes concorrentes
  -- disputando a mesma cotacao sao serializadas; a perdedora recebe 23505.
  if p_checkout_id is not null then
    select * into v_checkout from public.subscription_checkouts
     where id = p_checkout_id for update;

    if v_checkout.id is null then
      raise exception using errcode = '22023', message = 'Cotacao de checkout inexistente';
    end if;
    if v_checkout.user_id <> p_user_id then
      raise exception using errcode = '22023', message = 'Cotacao pertence a outro usuario';
    end if;
    if v_checkout.expires_at is not null and v_checkout.expires_at < v_now then
      raise exception using errcode = '22023', message = 'Cotacao de checkout expirada';
    end if;
    if v_checkout.status = 'completed'
       and v_checkout.completed_payment_id is not null
       and v_checkout.completed_payment_id <> v_pid then
      raise exception using errcode = '23505', message = 'Cotacao ja consumida por outro pagamento';
    end if;
  end if;

  -- 4. Tenta inserir o registro de pagamento (idempotencia via constraint UNIQUE)
  insert into public.subscription_payments (
    mercadopago_payment_id,
    user_id,
    months,
    validity_days,
    amount,
    status,
    checkout_id,
    processed_at
  ) values (
    v_pid,
    p_user_id,
    v_months,
    v_validity_days,
    p_amount,
    coalesce(p_status, 'approved'),
    p_checkout_id,
    v_now
  )
  on conflict (mercadopago_payment_id) do nothing
  returning * into v_inserted;

  -- 5. Se ja foi processado anteriormente, retorna sem adicionar dias e com o status real
  if v_inserted.id is null then
    -- Garante a marcacao da cotacao pelo pagamento que a consumiu (idempotente).
    if p_checkout_id is not null then
      update public.subscription_checkouts
         set status = 'completed',
             completed_payment_id = v_pid,
             completed_at = coalesce(completed_at, v_now)
       where id = p_checkout_id
         and (status <> 'completed' or completed_payment_id = v_pid);
    end if;

    select status, current_period_end into v_current_status, v_current_period_end
      from public.subscriptions
     where user_id = p_user_id;

    v_real_status := case
      when v_current_period_end is not null and v_current_period_end > v_now then 'active'
      when v_current_status is not null and v_current_status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid') then
        case
          when v_current_status = 'active' and (v_current_period_end is null or v_current_period_end <= v_now) then 'expired'
          else v_current_status
        end
      else 'expired'
    end;

    return jsonb_build_object(
      'already_processed', true,
      'current_period_end', v_current_period_end,
      'validity_days_added', 0,
      'status', v_real_status
    );
  end if;

  -- 6. Pagamento novo: calcula e adiciona vigencia atomicamente com lock
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

  -- 7. Marca a cotacao como consumida por este payment ID (mesma transacao)
  if p_checkout_id is not null then
    update public.subscription_checkouts
       set status = 'completed',
           completed_payment_id = v_pid,
           completed_at = v_now
     where id = p_checkout_id;
  end if;

  return jsonb_build_object(
    'already_processed', false,
    'current_period_end', v_new_period_end,
    'validity_days_added', v_validity_days,
    'status', 'active'
  );
end;
$$;

-- Garantia de permissoes: somente service_role pode chamar a funcao
revoke execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid) to service_role;
