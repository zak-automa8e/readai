-- Audio pipeline story 3 · spec §3 — money in micro-USD (1 USD = 1 000 000), O3.
-- The ledger is the truth; credit_accounts is the cached sum, written only by credit_apply (06).
-- No balance >= 0 constraint: a settle may overshoot its reservation; credit_apply refuses reserve/charge below zero.

create table public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance_micros bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.credit_accounts enable row level security;

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    check (kind in ('grant', 'reserve', 'settle', 'release', 'charge', 'rebate', 'refund', 'adjust')),
  amount_micros bigint not null,             -- signed
  unit text check (unit in ('tokens', 'audio_seconds')),
  quantity numeric,
  provider_cost_micros bigint,
  reservation_id uuid,
  ref_type text,
  ref_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);
create index credit_ledger_reservation_idx on public.credit_ledger (reservation_id) where reservation_id is not null;

alter table public.credit_ledger enable row level security;
