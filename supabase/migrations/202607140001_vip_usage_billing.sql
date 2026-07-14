-- x-lingo VIP / STT usage ledger
-- Apply with: supabase db push
-- All durations are integer seconds. Client code never writes balances directly.

create extension if not exists pgcrypto;

create table if not exists public.usage_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_mode text not null default 'metered'
    check (access_mode in ('metered', 'unlimited')),
  subscription_status text not null default 'none'
    check (subscription_status in ('none', 'active', 'grace', 'expired', 'revoked')),
  subscription_product_id text,
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.usage_accounts.access_mode is
  'Server-controlled owner/admin bypass. Never writable from the mobile client.';

create table if not exists public.usage_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('trial', 'subscription', 'credit_pack', 'adjustment')),
  source_ref text not null,
  priority smallint not null default 100,
  period_start timestamptz not null default now(),
  period_end timestamptz,
  granted_seconds integer not null check (granted_seconds >= 0),
  consumed_seconds integer not null default 0 check (consumed_seconds >= 0),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_ref),
  check (consumed_seconds + reserved_seconds <= granted_seconds)
);

create index if not exists usage_periods_available_idx
  on public.usage_periods (user_id, status, priority, period_end);

create table if not exists public.stt_usage_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null,
  file_id text not null,
  provider text not null default 'azure_batch',
  duration_seconds integer not null check (duration_seconds > 0),
  access_mode text not null check (access_mode in ('metered', 'unlimited')),
  status text not null default 'reserved'
    check (status in ('reserved', 'submitted', 'processing', 'settled', 'released', 'failed', 'reconcile_pending')),
  provider_job_url text,
  result_words jsonb,
  provider_error text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  settled_at timestamptz,
  unique (user_id, request_key)
);

create index if not exists stt_usage_jobs_user_status_idx
  on public.stt_usage_jobs (user_id, status, created_at desc);

create table if not exists public.stt_usage_allocations (
  job_id uuid not null references public.stt_usage_jobs(id) on delete cascade,
  period_id uuid not null references public.usage_periods(id),
  reserved_seconds integer not null check (reserved_seconds > 0),
  charged_seconds integer not null default 0 check (charged_seconds >= 0),
  primary key (job_id, period_id),
  check (charged_seconds <= reserved_seconds)
);

create table if not exists public.usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.stt_usage_jobs(id) on delete set null,
  period_id uuid references public.usage_periods(id) on delete set null,
  entry_type text not null
    check (entry_type in ('grant', 'reserve', 'settle', 'release', 'expire', 'revoke', 'adjust')),
  seconds integer not null check (seconds >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_ledger_user_created_idx
  on public.usage_ledger (user_id, created_at desc);

create unique index if not exists usage_ledger_grant_once_idx
  on public.usage_ledger (period_id, entry_type)
  where entry_type = 'grant';

alter table public.usage_accounts enable row level security;
alter table public.usage_periods enable row level security;
alter table public.stt_usage_jobs enable row level security;
alter table public.stt_usage_allocations enable row level security;
alter table public.usage_ledger enable row level security;

drop policy if exists "Users can read own usage account" on public.usage_accounts;
create policy "Users can read own usage account"
  on public.usage_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own usage periods" on public.usage_periods;
create policy "Users can read own usage periods"
  on public.usage_periods for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own usage ledger" on public.usage_ledger;
create policy "Users can read own usage ledger"
  on public.usage_ledger for select to authenticated
  using ((select auth.uid()) = user_id);

-- stt_usage_jobs and allocations intentionally have no client RLS policies.
-- They may contain provider identifiers and are accessed through Edge Functions.

create or replace function public.claim_stt_trial()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_period public.usage_periods;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.usage_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  insert into public.usage_periods (
    user_id, source, source_ref, priority, period_start, period_end, granted_seconds
  ) values (
    v_user_id, 'trial', 'lifetime_trial_v1', 10, now(), null, 900
  )
  on conflict (user_id, source, source_ref) do nothing;

  select * into v_period
  from public.usage_periods
  where user_id = v_user_id
    and source = 'trial'
    and source_ref = 'lifetime_trial_v1';

  if not exists (
    select 1 from public.usage_ledger
    where period_id = v_period.id and entry_type = 'grant'
  ) then
    insert into public.usage_ledger (user_id, period_id, entry_type, seconds, metadata)
    values (v_user_id, v_period.id, 'grant', 900, jsonb_build_object('source', 'trial'))
    on conflict do nothing;
  end if;

  return jsonb_build_object('claimed', true, 'granted_seconds', 900);
end;
$$;

create or replace function public.get_stt_usage_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.usage_accounts;
  v_granted integer := 0;
  v_consumed integer := 0;
  v_reserved integer := 0;
  v_available integer := 0;
  v_trial_available integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.usage_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.usage_accounts
  where user_id = v_user_id;

  select
    coalesce(sum(granted_seconds), 0)::integer,
    coalesce(sum(consumed_seconds), 0)::integer,
    coalesce(sum(reserved_seconds), 0)::integer,
    coalesce(sum(granted_seconds - consumed_seconds - reserved_seconds), 0)::integer,
    coalesce(sum(
      case when source = 'trial'
        then granted_seconds - consumed_seconds - reserved_seconds
        else 0 end
    ), 0)::integer
  into v_granted, v_consumed, v_reserved, v_available, v_trial_available
  from public.usage_periods
  where user_id = v_user_id
    and status = 'open'
    and period_start <= now()
    and (period_end is null or period_end > now());

  return jsonb_build_object(
    'access_mode', v_account.access_mode,
    'is_unlimited', v_account.access_mode = 'unlimited',
    'subscription_status', v_account.subscription_status,
    'subscription_product_id', v_account.subscription_product_id,
    'subscription_expires_at', v_account.subscription_expires_at,
    'granted_seconds', v_granted,
    'consumed_seconds', v_consumed,
    'reserved_seconds', v_reserved,
    'available_seconds', case when v_account.access_mode = 'unlimited' then null else v_available end,
    'trial_available_seconds', v_trial_available
  );
end;
$$;

create or replace function public.reserve_stt_usage(
  p_request_key text,
  p_file_id text,
  p_duration_seconds integer,
  p_provider text default 'azure_batch'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.usage_accounts;
  v_existing public.stt_usage_jobs;
  v_job_id uuid;
  v_period record;
  v_needed integer := p_duration_seconds;
  v_take integer;
  v_available integer;
  v_max_file_seconds integer;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_duration_seconds is null or p_duration_seconds <= 0 then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;
  if length(coalesce(p_request_key, '')) < 8 or length(coalesce(p_file_id, '')) < 1 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  insert into public.usage_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select * into v_existing
  from public.stt_usage_jobs
  where user_id = v_user_id and request_key = p_request_key;

  if found then
    return jsonb_build_object(
      'job_id', v_existing.id,
      'status', v_existing.status,
      'duration_seconds', v_existing.duration_seconds,
      'is_unlimited', v_existing.access_mode = 'unlimited',
      'idempotent_replay', true
    );
  end if;

  select * into v_account
  from public.usage_accounts
  where user_id = v_user_id
  for update;

  if v_account.access_mode <> 'unlimited' then
    select case
      when v_account.subscription_status in ('active', 'grace')
        or exists (
          select 1 from public.usage_periods
          where user_id = v_user_id
            and source = 'credit_pack'
            and status = 'open'
            and period_start <= now()
            and (period_end is null or period_end > now())
            and granted_seconds > consumed_seconds + reserved_seconds
        )
      then 3600 else 300 end
    into v_max_file_seconds;

    if p_duration_seconds > v_max_file_seconds then
      raise exception 'FILE_DURATION_LIMIT:%', v_max_file_seconds using errcode = 'P0001';
    end if;
  end if;

  if v_account.access_mode = 'unlimited' then
    insert into public.stt_usage_jobs (
      user_id, request_key, file_id, provider, duration_seconds, access_mode
    ) values (
      v_user_id, p_request_key, p_file_id, p_provider, p_duration_seconds, 'unlimited'
    ) returning id into v_job_id;

    return jsonb_build_object(
      'job_id', v_job_id,
      'status', 'reserved',
      'duration_seconds', p_duration_seconds,
      'is_unlimited', true,
      'available_seconds', null
    );
  end if;

  select coalesce(sum(granted_seconds - consumed_seconds - reserved_seconds), 0)::integer
  into v_available
  from public.usage_periods
  where user_id = v_user_id
    and status = 'open'
    and period_start <= now()
    and (period_end is null or period_end > now());

  if v_available < p_duration_seconds then
    raise exception 'QUOTA_EXCEEDED:%:%', v_available, p_duration_seconds
      using errcode = 'P0001';
  end if;

  insert into public.stt_usage_jobs (
    user_id, request_key, file_id, provider, duration_seconds, access_mode
  ) values (
    v_user_id, p_request_key, p_file_id, p_provider, p_duration_seconds, 'metered'
  ) returning id into v_job_id;

  for v_period in
    select id, granted_seconds, consumed_seconds, reserved_seconds
    from public.usage_periods
    where user_id = v_user_id
      and status = 'open'
      and period_start <= now()
      and (period_end is null or period_end > now())
      and granted_seconds > consumed_seconds + reserved_seconds
    order by priority asc, period_end asc nulls last, created_at asc
    for update
  loop
    exit when v_needed <= 0;
    v_take := least(
      v_needed,
      v_period.granted_seconds - v_period.consumed_seconds - v_period.reserved_seconds
    );

    update public.usage_periods
    set reserved_seconds = reserved_seconds + v_take, updated_at = now()
    where id = v_period.id;

    insert into public.stt_usage_allocations (job_id, period_id, reserved_seconds)
    values (v_job_id, v_period.id, v_take);

    insert into public.usage_ledger (user_id, job_id, period_id, entry_type, seconds)
    values (v_user_id, v_job_id, v_period.id, 'reserve', v_take);

    v_needed := v_needed - v_take;
  end loop;

  return jsonb_build_object(
    'job_id', v_job_id,
    'status', 'reserved',
    'duration_seconds', p_duration_seconds,
    'is_unlimited', false,
    'available_seconds', v_available - p_duration_seconds
  );
end;
$$;

create or replace function public.settle_stt_usage_admin(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.stt_usage_jobs;
  v_allocation record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_job from public.stt_usage_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_job.status = 'settled' then return; end if;
  if v_job.status in ('released', 'failed') then
    raise exception 'JOB_ALREADY_RELEASED' using errcode = 'P0001';
  end if;

  if v_job.access_mode = 'metered' then
    for v_allocation in
      select * from public.stt_usage_allocations where job_id = p_job_id for update
    loop
      update public.usage_periods
      set reserved_seconds = reserved_seconds - v_allocation.reserved_seconds,
          consumed_seconds = consumed_seconds + v_allocation.reserved_seconds,
          updated_at = now()
      where id = v_allocation.period_id;

      update public.stt_usage_allocations
      set charged_seconds = reserved_seconds
      where job_id = p_job_id and period_id = v_allocation.period_id;

      insert into public.usage_ledger (user_id, job_id, period_id, entry_type, seconds)
      values (v_job.user_id, p_job_id, v_allocation.period_id, 'settle', v_allocation.reserved_seconds);
    end loop;
  end if;

  update public.stt_usage_jobs
  set status = 'settled', settled_at = now()
  where id = p_job_id;
end;
$$;

create or replace function public.release_stt_usage_admin(
  p_job_id uuid,
  p_reason text default 'provider_failed'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.stt_usage_jobs;
  v_allocation record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_job from public.stt_usage_jobs where id = p_job_id for update;
  if not found then return; end if;
  if v_job.status in ('released', 'failed') then return; end if;
  if v_job.status = 'settled' then
    raise exception 'JOB_ALREADY_SETTLED' using errcode = 'P0001';
  end if;

  if v_job.access_mode = 'metered' then
    for v_allocation in
      select * from public.stt_usage_allocations where job_id = p_job_id for update
    loop
      update public.usage_periods
      set reserved_seconds = reserved_seconds - v_allocation.reserved_seconds,
          updated_at = now()
      where id = v_allocation.period_id;

      insert into public.usage_ledger (user_id, job_id, period_id, entry_type, seconds, metadata)
      values (
        v_job.user_id, p_job_id, v_allocation.period_id, 'release',
        v_allocation.reserved_seconds, jsonb_build_object('reason', p_reason)
      );
    end loop;
  end if;

  update public.stt_usage_jobs
  set status = 'released', provider_error = left(p_reason, 500), settled_at = now()
  where id = p_job_id;
end;
$$;

create or replace function public.grant_subscription_cycle_admin(
  p_user_id uuid,
  p_source_ref text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_seconds integer default 3600,
  p_product_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_period_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into public.usage_accounts (
    user_id, subscription_status, subscription_product_id, subscription_expires_at, updated_at
  ) values (
    p_user_id, 'active', p_product_id, p_period_end, now()
  ) on conflict (user_id) do update set
    subscription_status = 'active',
    subscription_product_id = excluded.subscription_product_id,
    subscription_expires_at = excluded.subscription_expires_at,
    updated_at = now();

  insert into public.usage_periods (
    user_id, source, source_ref, priority, period_start, period_end, granted_seconds
  ) values (
    p_user_id, 'subscription', p_source_ref, 20, p_period_start, p_period_end, p_seconds
  ) on conflict (user_id, source, source_ref) do update set
    period_end = excluded.period_end,
    granted_seconds = greatest(public.usage_periods.granted_seconds, excluded.granted_seconds),
    status = 'open',
    updated_at = now()
  returning id into v_period_id;

  if not exists (select 1 from public.usage_ledger where period_id = v_period_id and entry_type = 'grant') then
    insert into public.usage_ledger (user_id, period_id, entry_type, seconds, metadata)
    values (p_user_id, v_period_id, 'grant', p_seconds, jsonb_build_object('source', 'subscription'))
    on conflict do nothing;
  end if;
  return v_period_id;
end;
$$;

create or replace function public.grant_credit_pack_admin(
  p_user_id uuid,
  p_transaction_id text,
  p_seconds integer,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_period_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into public.usage_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.usage_periods (
    user_id, source, source_ref, priority, period_start, period_end, granted_seconds
  ) values (
    p_user_id, 'credit_pack', p_transaction_id, 30, now(), p_expires_at, p_seconds
  ) on conflict (user_id, source, source_ref) do update set updated_at = now()
  returning id into v_period_id;

  if not exists (select 1 from public.usage_ledger where period_id = v_period_id and entry_type = 'grant') then
    insert into public.usage_ledger (user_id, period_id, entry_type, seconds, metadata)
    values (p_user_id, v_period_id, 'grant', p_seconds, jsonb_build_object('source', 'credit_pack'))
    on conflict do nothing;
  end if;
  return v_period_id;
end;
$$;

revoke all on function public.claim_stt_trial() from public;
revoke all on function public.get_stt_usage_status() from public;
revoke all on function public.reserve_stt_usage(text, text, integer, text) from public;
revoke all on function public.settle_stt_usage_admin(uuid) from public;
revoke all on function public.release_stt_usage_admin(uuid, text) from public;
revoke all on function public.grant_subscription_cycle_admin(uuid, text, timestamptz, timestamptz, integer, text) from public;
revoke all on function public.grant_credit_pack_admin(uuid, text, integer, timestamptz) from public;

grant execute on function public.claim_stt_trial() to authenticated;
grant execute on function public.get_stt_usage_status() to authenticated;
grant execute on function public.reserve_stt_usage(text, text, integer, text) to authenticated;
grant execute on function public.settle_stt_usage_admin(uuid) to service_role;
grant execute on function public.release_stt_usage_admin(uuid, text) to service_role;
grant execute on function public.grant_subscription_cycle_admin(uuid, text, timestamptz, timestamptz, integer, text) to service_role;
grant execute on function public.grant_credit_pack_admin(uuid, text, integer, timestamptz) to service_role;

-- OWNER UNLIMITED SWITCH (run once in Supabase SQL Editor after replacing the email):
-- insert into public.usage_accounts (user_id, access_mode)
-- select id, 'unlimited' from auth.users where email = 'YOUR_EMAIL'
-- on conflict (user_id) do update set access_mode = 'unlimited', updated_at = now();
--
-- Disable it again:
-- update public.usage_accounts set access_mode = 'metered', updated_at = now()
-- where user_id = (select id from auth.users where email = 'YOUR_EMAIL');
