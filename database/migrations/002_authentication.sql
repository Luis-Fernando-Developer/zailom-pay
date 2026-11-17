-- Zailom Pay: administrative authentication and sessions.
create table if not exists public.zp_auth_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text not null,
  role text not null default 'admin' check (role in ('superadmin', 'admin', 'operator', 'viewer')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists zp_auth_users_email_lower_unique
  on public.zp_auth_users (lower(email));

create table if not exists public.zp_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.zp_auth_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  ip_address inet,
  user_agent text
);
create index if not exists zp_auth_sessions_user_idx on public.zp_auth_sessions(user_id);
create index if not exists zp_auth_sessions_expiry_idx on public.zp_auth_sessions(expires_at);

create table if not exists public.zp_auth_audit (
  id bigserial primary key,
  user_id uuid references public.zp_auth_users(id) on delete set null,
  event_type text not null,
  email text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists zp_auth_audit_created_idx on public.zp_auth_audit(created_at desc);

comment on table public.zp_auth_users is 'Administrative identities for the Zailom Pay control panel.';
comment on table public.zp_auth_sessions is 'Opaque, hashed server-side sessions. Raw session tokens are never stored.';
