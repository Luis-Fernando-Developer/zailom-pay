-- Zailom Pay: financial foundation (standalone PostgreSQL 16)
-- All monetary amounts are integer minor units (e.g. centavos).
-- This migration intentionally exposes no direct client policies; financial writes
-- must go through trusted backend functions using the service role.

create extension if not exists pgcrypto;

do $$ begin
  create type public.zp_product_code as enum ('booking', 'flow', 'orbit', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zp_participant_type as enum ('platform', 'company', 'professional', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zp_kyc_status as enum ('not_started', 'pending', 'under_review', 'approved', 'rejected', 'action_required', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zp_account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zp_entry_direction as enum ('debit', 'credit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zp_transaction_status as enum ('draft', 'posted', 'reversed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.zp_payout_status as enum ('requested', 'approved', 'processing', 'paid', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.zp_products (
  id uuid primary key default gen_random_uuid(),
  code public.zp_product_code not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.zp_products (code, name)
values ('booking', 'Zailom Booking'), ('flow', 'Zailom Flow'), ('orbit', 'Zailom Orbit'), ('other', 'Outros')
on conflict (code) do nothing;

create table if not exists public.zp_organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text,
  trade_name text,
  tax_id text,
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists zp_organizations_tax_id_unique
  on public.zp_organizations (tax_id) where tax_id is not null;

create table if not exists public.zp_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.zp_organizations(id) on delete restrict,
  external_user_id text, -- ID de identidade do sistema de autenticação definido pelo backend
  participant_type public.zp_participant_type not null,
  display_name text not null,
  email text,
  tax_id text,
  kyc_status public.zp_kyc_status not null default 'not_started',
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zp_participants_organization_idx on public.zp_participants (organization_id);
create index if not exists zp_participants_external_user_idx on public.zp_participants (external_user_id);
create index if not exists zp_participants_tax_id_idx on public.zp_participants (tax_id);

create table if not exists public.zp_provider_recipients (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.zp_participants(id) on delete restrict,
  provider_code text not null,
  external_recipient_id text,
  onboarding_status text not null default 'not_started',
  kyc_status public.zp_kyc_status not null default 'not_started',
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, provider_code),
  unique (provider_code, external_recipient_id)
);

create table if not exists public.zp_ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.zp_participants(id) on delete restrict,
  product_id uuid references public.zp_products(id) on delete restrict,
  account_code text not null,
  account_name text not null,
  account_type public.zp_account_type not null,
  currency char(3) not null default 'BRL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (participant_id, product_id, account_code, currency)
);

create index if not exists zp_ledger_accounts_participant_idx on public.zp_ledger_accounts (participant_id);

create table if not exists public.zp_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.zp_products(id) on delete restrict,
  organization_id uuid references public.zp_organizations(id) on delete restrict,
  event_type text not null,
  status public.zp_transaction_status not null default 'draft',
  idempotency_key text not null unique,
  source_type text,
  source_id text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'posted' or posted_at is not null)
);

create index if not exists zp_ledger_transactions_org_created_idx
  on public.zp_ledger_transactions (organization_id, created_at desc);
create index if not exists zp_ledger_transactions_source_idx
  on public.zp_ledger_transactions (source_type, source_id);

create table if not exists public.zp_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.zp_ledger_transactions(id) on delete restrict,
  account_id uuid not null references public.zp_ledger_accounts(id) on delete restrict,
  direction public.zp_entry_direction not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'BRL',
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists zp_ledger_entries_transaction_idx on public.zp_ledger_entries (transaction_id);
create index if not exists zp_ledger_entries_account_created_idx on public.zp_ledger_entries (account_id, created_at desc);

create or replace function public.zp_assert_posted_transaction_balanced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_status public.zp_transaction_status;
  v_unbalanced_count integer;
begin
  v_transaction_id := coalesce(new.transaction_id, old.transaction_id);
  select status into v_status
  from public.zp_ledger_transactions
  where id = v_transaction_id;

  if v_status = 'posted' then
    select count(*) into v_unbalanced_count
    from (
      select currency
      from public.zp_ledger_entries
      where transaction_id = v_transaction_id
      group by currency
      having sum(case when direction = 'debit' then amount_minor else 0 end)
          <> sum(case when direction = 'credit' then amount_minor else 0 end)
    ) unbalanced;

    if v_unbalanced_count > 0 then
      raise exception 'Posted ledger transaction % is not balanced', v_transaction_id;
    end if;

    if not exists (
      select 1 from public.zp_ledger_entries where transaction_id = v_transaction_id
    ) then
      raise exception 'Posted ledger transaction % has no entries', v_transaction_id;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists zp_ledger_entries_balance_check on public.zp_ledger_entries;
create constraint trigger zp_ledger_entries_balance_check
after insert or update or delete on public.zp_ledger_entries
deferrable initially deferred
for each row execute function public.zp_assert_posted_transaction_balanced();

create or replace function public.zp_assert_transaction_balanced_on_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unbalanced_count integer;
begin
  if new.status = 'posted' and old.status is distinct from new.status then
    select count(*) into v_unbalanced_count
    from (
      select currency
      from public.zp_ledger_entries
      where transaction_id = new.id
      group by currency
      having sum(case when direction = 'debit' then amount_minor else 0 end)
          <> sum(case when direction = 'credit' then amount_minor else 0 end)
    ) unbalanced;

    if v_unbalanced_count > 0 or not exists (
      select 1 from public.zp_ledger_entries where transaction_id = new.id
    ) then
      raise exception 'Cannot post an unbalanced or empty ledger transaction';
    end if;

    if new.posted_at is null then
      new.posted_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists zp_ledger_transaction_post_check on public.zp_ledger_transactions;
create trigger zp_ledger_transaction_post_check
before update of status on public.zp_ledger_transactions
for each row execute function public.zp_assert_transaction_balanced_on_post();

create table if not exists public.zp_payout_requests (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.zp_participants(id) on delete restrict,
  product_id uuid references public.zp_products(id) on delete restrict,
  provider_code text not null,
  external_payout_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'BRL',
  status public.zp_payout_status not null default 'requested',
  idempotency_key text not null unique,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  unique (provider_code, external_payout_id)
);

create index if not exists zp_payout_requests_participant_idx
  on public.zp_payout_requests (participant_id, requested_at desc);

create table if not exists public.zp_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider_code, external_event_id)
);

create index if not exists zp_provider_events_unprocessed_idx
  on public.zp_provider_events (received_at) where processed_at is null;

comment on table public.zp_ledger_entries is 'Append-only financial postings in integer minor units; do not update/delete posted history.';
comment on table public.zp_provider_events is 'Idempotent inbox for provider webhooks; persist before processing.';
