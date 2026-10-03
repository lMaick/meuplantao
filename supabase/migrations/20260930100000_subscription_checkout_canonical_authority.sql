-- Migration: Autoridade canonica da cotacao na RPC de billing (MAI-152)
-- A RPC process_mercadopago_subscription_payment passa a derivar plano,
-- preco, vigencia, moeda e periodo da cotacao persistida em
-- subscription_checkouts (p_checkout_id), nunca dos parametros do caller.
--
-- DECISAO (MAI-152): opcao A — mesma assinatura, sem quebrar producao.
--   - Mantem exatamente 7 args (text, uuid, integer, integer, numeric, text, uuid),
--     sem DEFAULT, sem DROP de overload, sem nova versao da RPC.
--   - Callers atuais (validatePaymentBeforeGrantingPro -> processMercadoPagoPayment)
--     ja enviam os valores canonicos do checkout, portanto a rejeicao de
--     divergencia nao quebra o fluxo valido entre migration e deploy.
--   - Opcao B (nova versao + migracao coordenada de caller + schema gate)
--     foi descartada por exigir janela coordenada migration/deploy com risco
--     de incompatibilidade de assinatura no Schema Gate.
--
-- ORDEM (MAI-152): quinta migration do bloco de billing, apos
--   20260929400000_subscription_checkout_required_failclosed.sql e
--   20260930000000_payment_future_date_guard.sql (bloco financeiro).
-- Efeito:
--   1. SELECT ... FOR UPDATE da cotacao permanece como autoridade (lock atomico).
--   2. Sanidade fail-closed da cotacao (months/validity/amount/plan_id/currency).
--   3. Rejeita divergencia do caller (22023) em months, validity_days e amount;
--      checkout mensal nunca produz vigencia anual por parametro divergente.
--   4. Ledger e vigencia derivam exclusivamente da cotacao (plan_id, currency,
--      amount_cents e catalog_version persistidos no ledger).
--   5. Preserva single consumption, payment_id idempotente, concorrencia
--      serializada (advisory lock + FOR UPDATE + UNIQUE) e grants service_role.
--   6. Nao confia em metadata do Mercado Pago; nao remove checkout persistido.

-- Mesma assinatura: CREATE OR REPLACE sem DROP (PostgreSQL substitui o corpo
-- mantendo a identidade da funcao; Schema Gate de 7 args permanece verde).
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
  v_existing_user_id uuid;
  -- MAI-152: valores canonicos derivados da cotacao bloqueada.
  v_c_months integer;
  v_c_validity integer;
  v_c_amount numeric;
  v_c_amount_cents integer;
  v_c_plan_id text;
  v_c_currency text;
  v_c_catalog text;
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

  -- 3b. Autoridade canonica da cotacao (MAI-152, opcao A).
  -- Deriva periodo, vigencia, valor, plano e moeda da linha bloqueada acima;
  -- nunca confia nos parametros do caller nem em metadata do provedor.
  v_c_months := v_checkout.months;
  v_c_validity := v_checkout.validity_days;
  v_c_amount := v_checkout.amount;
  v_c_amount_cents := v_checkout.amount_cents;
  v_c_plan_id := v_checkout.plan_id;
  v_c_currency := v_checkout.currency;
  v_c_catalog := v_checkout.catalog_version;

  -- Sanidade fail-closed da cotacao persistida (linha corrompida nunca concede).
  if v_c_months is null or v_c_months <= 0 then
    raise exception using errcode = '22023', message = 'Cotacao com months invalido';
  end if;
  if v_c_validity is null or v_c_validity <= 0 then
    raise exception using errcode = '22023', message = 'Cotacao com validity_days invalido';
  end if;
  if v_c_amount is null or v_c_amount <= 0 then
    raise exception using errcode = '22023', message = 'Cotacao com amount invalido';
  end if;
  if v_c_plan_id is null or btrim(v_c_plan_id) = '' then
    raise exception using errcode = '22023', message = 'Cotacao sem plan_id canonico';
  end if;
  if v_c_currency is null or btrim(upper(v_c_currency)) <> 'BRL' then
    raise exception using errcode = '22023', message = 'Cotacao com moeda nao suportada';
  end if;
  if v_c_amount_cents is not null
     and v_c_amount_cents <> round(v_c_amount * 100)::integer then
    raise exception using errcode = '22023', message = 'Cotacao com divergencia interna de valor';
  end if;

  -- Rejeita divergencia do caller (mesma assinatura; valores do checkout prevalecem).
  -- Checkout mensal nunca produz vigencia anual por parametro divergente.
  if p_months is distinct from v_c_months then
    raise exception using errcode = '22023', message = 'Divergencia de months em relacao a cotacao';
  end if;
  if p_validity_days is distinct from v_c_validity then
    raise exception using errcode = '22023', message = 'Divergencia de validity_days em relacao a cotacao';
  end if;
  if p_amount is distinct from v_c_amount then
    raise exception using errcode = '22023', message = 'Divergencia de amount em relacao a cotacao';
  end if;

  -- A partir daqui, autoridade exclusiva da cotacao.
  v_months := v_c_months;
  v_validity_days := v_c_validity;

  -- 4. Tenta inserir o registro de pagamento (idempotencia via constraint UNIQUE).
  -- Ledger deriva da cotacao: plan_id, currency, amount_cents e catalog_version
  -- canonicos, nunca do caller.
  insert into public.subscription_payments (
    mercadopago_payment_id,
    user_id,
    months,
    validity_days,
    amount,
    status,
    checkout_id,
    plan_id,
    currency,
    amount_cents,
    catalog_version,
    processed_at
  ) values (
    v_pid,
    p_user_id,
    v_months,
    v_validity_days,
    v_c_amount,
    coalesce(p_status, 'approved'),
    p_checkout_id,
    v_c_plan_id,
    v_c_currency,
    coalesce(v_c_amount_cents, round(v_c_amount * 100)::integer),
    v_c_catalog,
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
    select checkout_id, user_id into v_existing_checkout_id, v_existing_user_id
      from public.subscription_payments
     where mercadopago_payment_id = v_pid;

    -- Validacao de ownership (MAI-147 auditoria): um pagamento ja registrado para userA
    -- nao pode ser consumido, vinculado ou estendido por userB.
    if v_existing_user_id is distinct from p_user_id then
      raise exception using errcode = '22023',
        message = 'Pagamento pertence a outro usuario';
    end if;

    if v_existing_checkout_id is not null and v_existing_checkout_id <> p_checkout_id then
      raise exception using errcode = '23505',
        message = 'Cotacao divergente para pagamento ja processado';
    end if;

    -- Se o registro existente nao tinha checkout_id (ex.: stub de reversao fora de ordem ou legado),
    -- vincula a cotacao que chegou agora para fechar o ciclo.
    if v_existing_checkout_id is null then
      update public.subscription_payments
         set checkout_id = p_checkout_id,
             plan_id = coalesce(plan_id, v_c_plan_id),
             currency = coalesce(currency, v_c_currency),
             amount_cents = coalesce(amount_cents, v_c_amount_cents),
             catalog_version = coalesce(catalog_version, v_c_catalog)
       where mercadopago_payment_id = v_pid;
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

  -- 6. Pagamento novo: calcula e adiciona vigencia atomicamente com lock.
  -- Vigencia deriva da cotacao canonica (v_validity_days ja sobrescrito acima).
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
-- Mesma assinatura de 7 args (MAI-147 fail-closed); sem DROP para nao reabrir
-- janela de overload entre migration e deploy (opcao A).
revoke execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.process_mercadopago_subscription_payment(text, uuid, integer, integer, numeric, text, uuid) to service_role;
