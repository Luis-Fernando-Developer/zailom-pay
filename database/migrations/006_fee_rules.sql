-- Configurable platform fee rules. Rules start disabled until explicitly enabled.
create table if not exists public.zp_fee_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.zp_products(id) on delete restrict,
  event_type text not null,
  fee_type text not null check (fee_type in ('fixed','percentage','hybrid')),
  fixed_amount_minor bigint not null default 0 check (fixed_amount_minor >= 0),
  rate_bps integer not null default 0 check (rate_bps between 0 and 10000),
  minimum_amount_minor bigint check (minimum_amount_minor is null or minimum_amount_minor >= 0),
  maximum_amount_minor bigint check (maximum_amount_minor is null or maximum_amount_minor >= 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,event_type),
  check (fee_type <> 'fixed' or fixed_amount_minor > 0),
  check (fee_type <> 'percentage' or rate_bps > 0),
  check (fee_type <> 'hybrid' or (fixed_amount_minor > 0 and rate_bps > 0)),
  check (maximum_amount_minor is null or minimum_amount_minor is null or maximum_amount_minor >= minimum_amount_minor)
);
create index if not exists zp_fee_rules_enabled_idx
  on public.zp_fee_rules(product_id,event_type) where enabled = true;
comment on table public.zp_fee_rules is
  'Platform fee configuration. Enabling a rule does not charge by itself; payment integrations must explicitly apply it.';
