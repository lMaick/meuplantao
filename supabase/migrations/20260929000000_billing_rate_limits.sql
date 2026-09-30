-- Migration: MAI-138 — distributed billing rate-limit buckets (serverless-safe).
-- Shared counter table + atomic RPCs used by src/lib/billing/rate-limit.ts
-- (SupabaseRateLimitStore). Service-role only: RLS enabled with NO public
-- policies; service_role bypasses RLS. Never store raw IPs here — keys arriving
-- from the app already carry a truncated hash (see hashIpForLog).

create table if not exists public.billing_rate_limits (
  bucket_key text primary key,
  hit_count integer not null default 1,
  window_start timestamptz not null default now(),
  expires_at timestamptz not null default now()
);

create index if not exists billing_rate_limits_expires_at_idx
  on public.billing_rate_limits (expires_at);

alter table public.billing_rate_limits enable row level security;

revoke all on public.billing_rate_limits from anon, authenticated, public;
grant all on public.billing_rate_limits to service_role;

-- Atomic fixed-window hit: returns the current count and remaining TTL (ms).
create or replace function public.billing_rate_limit_hit(
  p_bucket_key text,
  p_window_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_expires timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or trim(p_bucket_key) = '' then
    raise exception using errcode = '22023', message = 'Bucket key ausente';
  end if;

  update public.billing_rate_limits
     set hit_count = hit_count + 1
   where bucket_key = p_bucket_key
     and expires_at > v_now
  returning hit_count, expires_at into v_count, v_expires;

  if not found then
    v_expires := v_now + make_interval(secs => v_window);
    insert into public.billing_rate_limits (bucket_key, hit_count, window_start, expires_at)
    values (p_bucket_key, 1, v_now, v_expires)
    on conflict (bucket_key) do update
      set hit_count = case
                        when billing_rate_limits.expires_at <= v_now then 1
                        else billing_rate_limits.hit_count + 1
                      end,
          window_start = case
                           when billing_rate_limits.expires_at <= v_now then v_now
                           else billing_rate_limits.window_start
                         end,
          expires_at = case
                         when billing_rate_limits.expires_at <= v_now then v_expires
                         else billing_rate_limits.expires_at
                       end
    returning billing_rate_limits.hit_count, billing_rate_limits.expires_at
      into v_count, v_expires;
  end if;

  return jsonb_build_object(
    'count', v_count,
    'ttl_ms', greatest(ceil(extract(epoch from (v_expires - v_now)) * 1000)::bigint, 0)
  );
end;
$$;

-- Best-effort unlock total da chave (semântica de release para cooldown e
-- in-flight lock, MAI-138 auditoria externa): remove o registro por completo
-- em vez de decrementar. Sob contenção concorrente, múltiplos hits elevam o
-- contador; decrementar apenas 1 deixaria o lock meio preso até o TTL,
-- bloqueando com 429 o retry legítimo do Mercado Pago. Never raises:
-- returns false when no-op.
create or replace function public.billing_rate_limit_release(
  p_bucket_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_bucket_key is null or trim(p_bucket_key) = '' then
    return false;
  end if;

  delete from public.billing_rate_limits
   where bucket_key = p_bucket_key;

  return found;
exception
  when others then
    return false;
end;
$$;

revoke all on function public.billing_rate_limit_hit(text, integer) from anon, authenticated, public;
grant execute on function public.billing_rate_limit_hit(text, integer) to service_role;

revoke all on function public.billing_rate_limit_release(text) from anon, authenticated, public;
grant execute on function public.billing_rate_limit_release(text) to service_role;
