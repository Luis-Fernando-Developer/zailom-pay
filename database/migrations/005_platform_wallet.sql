-- Platform treasury accounts and withdrawal request history.
insert into public.zp_ledger_accounts
  (participant_id, product_id, account_code, account_name, account_type, currency)
select null, null, seed.account_code, seed.account_name, seed.account_type::public.zp_account_type, 'BRL'
from (values
  ('platform_cash', 'Disponibilidade financeira da Zailom', 'asset'),
  ('platform_payouts_payable', 'Saques da plataforma em processamento', 'liability')
) as seed(account_code, account_name, account_type)
where not exists (
  select 1 from public.zp_ledger_accounts a
  where a.participant_id is null and a.product_id is null
    and a.account_code = seed.account_code and a.currency = 'BRL'
);

create table if not exists public.zp_platform_payout_requests (
  id uuid primary key default gen_random_uuid(),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'BRL',
  status text not null default 'requested'
    check (status in ('requested','approved','processing','paid','failed','cancelled')),
  destination_label text,
  destination_fingerprint text,
  idempotency_key text not null unique,
  requested_by uuid references public.zp_auth_users(id) on delete set null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists zp_platform_payout_requests_recent_idx
  on public.zp_platform_payout_requests(requested_at desc);
comment on table public.zp_platform_payout_requests is
  'Platform treasury withdrawals. Requests are records only; provider execution must be explicitly integrated.';
