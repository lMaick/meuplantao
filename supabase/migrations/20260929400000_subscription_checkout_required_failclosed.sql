-- Migration: Cotacao obrigatoria fail-closed no consumo unico (MAI-147)
-- Resolve o bypass auditado em 20260929300000: p_checkout_id nulo pulava o
-- claim e ainda concedia vigencia, e a sobrecarga anterior de 6 argumentos
-- permanecia definida (overload Postgres nao e substituido por CREATE OR REPLACE
-- com assinatura distinta).
--
-- ORDEM (MAI-147): quarta migration do bloco de billing, apos
--   20260929300000_subscription_checkout_single_consumption.sql.
-- Efeito:
--   1. Remove definitivamente a sobrecarga legada de 6 args.
--   2. Redefine a RPC de 7 args com p_checkout_id OBRIGATORIO (sem default):
--      chamada sem cotacao falha no banco (null => errcode 22023,
--      mensagem 'Cotacao de checkout obrigatoria'), sem conceder vigencia.
--   3. Mantem o claim atomico da cotacao na mesma transacao da vigencia,
--      idempotencia por payment ID e grants restritos ao service_role.

-- 1. Remove a sobrecarga legada de 6 argumentos (validity_guard).
-- Postgres trata assinaturas distintas como overloads independentes, por isso
-- o DROP explicito e obrigatorio para fechar o bypass pela funcao anterior.
drop function if exists public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text);

-- 1b. Remove a assinatura de 7 argumentos criada em 20260929300000 com
-- valor DEFAULT NULL em p_checkout_id. O PostgreSQL rejeita CREATE OR REPLACE que
-- remove DEFAULT de parametro existente (SQLSTATE 42P13:
-- "cannot remove parameter defaults from existing function"), por isso o DROP
-- explicito da assinatura de 7 args e obrigatorio antes da recriacao
-- fail-closed (p_checkout_id obrigatorio, sem DEFAULT).
drop function if exists public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid);

-- 2. Redefine a RPC exigindo cotacao (sem DEFAULT => parametro obrigatorio).
create or replace function public.process_mercadopago_subscription_payment(
  p_payment_id text,
  p_user_id uuid,
  p_months integer,
  p_validity_days integer,
  p_amount numeric,
  p_status text,
  p_checkout_id uuid
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
  v_existing_checkout_id uuid;
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

  -- 1b. Cotacao obrigatoria (MAI-147 fail-closed): sem cotacao vinculada nao
  -- ha concessao de vigencia. Chamadas antigas sem p_checkout_id falham aqui
  -- em vez de conceder Pro sem consumir cotacao.
  if p_checkout_id is null then
    raise exception using errcode = '22023', message = 'Cotacao de checkout obrigatoria';
  end if;

  -- 2. Serializacao estrita por usuario via advisory lock de transacao
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- 3. Claim atomico da cotacao (CAS sob lock): duas transacoes concorrentes
  -- disputando a mesma cotacao sao serializadas; a perdedora recebe 23505.
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
    -- Consistencia 1:1 pagamento <-> cotacao (MAI-147 auditoria): o pagamento
    -- ja registrado esta vinculado a uma unica cotacao. Reenviar o mesmo
    -- payment ID com outro checkout_id deve falhar em vez de marcar um
    -- segundo checkout como concluido.
    select checkout_id into v_existing_checkout_id
      from public.subscription_payments
     where mercadopago_payment_id = v_pid;

    if v_existing_checkout_id is distinct from p_checkout_id then
      raise exception using errcode = '23505',
        message = 'Cotacao divergente para pagamento ja processado';
    end if;

    -- Garante a marcacao da cotacao pelo pagamento que a consumiu (idempotente).
    update public.subscription_checkouts
       set status = 'completed',
           completed_payment_id = v_pid,
           completed_at = coalesce(completed_at, v_now)
     where id = p_checkout_id
       and (status <> 'completed' or completed_payment_id = v_pid);

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
  update public.subscription_checkouts
     set status = 'completed',
         completed_payment_id = v_pid,
         completed_at = v_now
   where id = p_checkout_id;

  return jsonb_build_object(
    'already_processed', false,
    'current_period_end', v_new_period_end,
    'validity_days_added', v_validity_days,
    'status', 'active'
  );
end;
$$;

-- Garantia de permissoes: somente service_role pode chamar a funcao.
-- Ambas as assinaturas (6 e 7 args) foram dropadas acima (PostgreSQL rejeita
-- REVOKE em funcao inexistente), por isso revoga/concede apenas a assinatura
-- de 7 args recriada fail-closed.
revoke execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid) to service_role;
