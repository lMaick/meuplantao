-- Migration: Validar validity_days e months na RPC de processamento de pagamentos
-- MAI-134: Auditoria reprovou a ausência de validação de validity_days <= 0 e months <= 0.
-- A implementação anterior usava coalesce(p_validity_days, 30) sem bloquear zero/negativo,
-- permitindo vigência negativa. Esta migration corrige o boundary sem reescrever histórico.

create or replace function public.process_mercadopago_subscription_payment(
  p_payment_id text,
  p_user_id uuid,
  p_months integer,
  p_validity_days integer,
  p_amount numeric,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted public.subscription_payments;
  v_current_period_end timestamptz;
  v_current_status text;
  v_new_period_end timestamptz;
  v_real_status text;
  v_validity_days integer := coalesce(p_validity_days, 30);
  v_months integer := coalesce(p_months, 1);
  v_now timestamptz := now();
begin
  -- 1. Validações de entrada (boundary estrito — fail-closed)
  if p_payment_id is null or trim(p_payment_id) = '' then
    raise exception using errcode = '22023', message = 'Identificador do pagamento ausente';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Identificador do usuario ausente';
  end if;
  -- validity_days deve ser estritamente positivo; zero e negativo são inválidos (MAI-134)
  if v_validity_days <= 0 then
    raise exception using errcode = '22023',
      message = 'validity_days deve ser maior que zero';
  end if;
  -- months deve ser estritamente positivo (MAI-134)
  if v_months <= 0 then
    raise exception using errcode = '22023',
      message = 'months deve ser maior que zero';
  end if;

  -- 2. Serialização estrita por usuário via advisory lock de transação
  -- Garante atomicidade e evita concorrência mesmo quando o usuário ainda não possui linha em subscriptions
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- 3. Tenta inserir o registro de pagamento (idempotência via constraint UNIQUE)
  insert into public.subscription_payments (
    mercadopago_payment_id,
    user_id,
    months,
    validity_days,
    amount,
    status,
    processed_at
  ) values (
    trim(p_payment_id),
    p_user_id,
    v_months,
    v_validity_days,
    p_amount,
    coalesce(p_status, 'approved'),
    v_now
  )
  on conflict (mercadopago_payment_id) do nothing
  returning * into v_inserted;

  -- 4. Se já foi processado anteriormente, retorna sem adicionar dias e com o status real
  if v_inserted.id is null then
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

  -- 5. Pagamento novo: calcula e adiciona vigência atomicamente com lock
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

  return jsonb_build_object(
    'already_processed', false,
    'current_period_end', v_new_period_end,
    'validity_days_added', v_validity_days,
    'status', 'active'
  );
end;
$$;

-- Garantia de permissões: somente service_role pode chamar a função
revoke execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text) to service_role;
