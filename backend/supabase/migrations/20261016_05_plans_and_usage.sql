-- Audio pipeline story 3 · spec §3 (revised 2026-10-16, O12) — subscription plans with a daily page limit.
-- Plans are assigned by hand in subscriptions until the payment story (12).

create table public.plans (
  id text primary key,
  name text not null,
  price_cents int not null default 0 check (price_cents >= 0),
  currency text not null default 'usd',
  daily_page_limit int not null check (daily_page_limit >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.plans enable row level security;

insert into public.plans (id, name, price_cents, daily_page_limit, sort_order) values
  ('free', 'Free', 0, 2, 0),
  ('basic', 'Basic', 500, 10, 1),
  ('pro', 'Pro', 1500, 50, 2);

-- No row, or a row that is not active, means the free plan.
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null default 'active' check (status in ('active', 'canceled')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- A page counts once per user per UTC day, the first time listening reaches it in Listen mode.
create table public.daily_page_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  book_id uuid not null references public.books (id) on delete cascade,
  page_number int not null check (page_number >= 1),
  first_listened_at timestamptz not null default now(),
  primary key (user_id, usage_date, book_id, page_number)
);

alter table public.daily_page_usage enable row level security;
