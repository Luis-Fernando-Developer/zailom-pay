-- Hierarchical fee management: platform defaults, commercial groups, company exceptions.
create table if not exists public.zp_fee_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.zp_products(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 100),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, name)
);

create table if not exists public.zp_fee_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.zp_fee_groups(id) on delete cascade,
  organization_id uuid not null references public.zp_organizations(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(group_id, organization_id)
);
create index if not exists zp_fee_group_members_org_idx
  on public.zp_fee_group_members(organization_id);

-- An organization can belong to only one active commercial group per product.
create unique index if not exists zp_fee_group_one_active_per_product_idx
  on public.zp_fee_group_members(organization_id, (select product_id from public.zp_fee_groups where id = group_id));

create table if not exists public.zp_fee_group_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.zp_fee_groups(id) on delete cascade,
  event_type text not null,
  fee_type text not null check (fee_type in ('fixed','percentage','hybrid')),
  fixed_amount_minor bigint not null default 0 check (fixed_amount_minor >= 0),
  rate_bps integer not null default 0 check (rate_bps between 0 and 10000),
  minimum_amount_minor bigint check (minimum_amount_minor is null or minimum_amount_minor >= 0),
  maximum_amount_minor bigint check (maximum_amount_minor is null or maximum_amount_minor >= 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id,event_type),
  check (fee_type <> 'fixed' or fixed_amount_minor > 0),
  check (fee_type <> 'percentage' or rate_bps > 0),
  check (fee_type <> 'hybrid' or (fixed_amount_minor > 0 and rate_bps > 0)),
  check (maximum_amount_minor is null or minimum_amount_minor is null or maximum_amount_minor >= minimum_amount_minor)
);

create table if not exists public.zp_company_fee_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.zp_organizations(id) on delete restrict,
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
  unique(organization_id,product_id,event_type),
  check (fee_type <> 'fixed' or fixed_amount_minor > 0),
  check (fee_type <> 'percentage' or rate_bps > 0),
  check (fee_type <> 'hybrid' or (fixed_amount_minor > 0 and rate_bps > 0)),
  check (maximum_amount_minor is null or minimum_amount_minor is null or maximum_amount_minor >= minimum_amount_minor)
);
create index if not exists zp_company_fee_rules_lookup_idx
  on public.zp_company_fee_rules(organization_id,product_id,event_type) where enabled = true;

comment on table public.zp_fee_groups is 'Commercial fee groups scoped to one Zailom product.';
comment on table public.zp_company_fee_rules is 'Company-specific fee overrides; highest priority over group and product defaults.';
