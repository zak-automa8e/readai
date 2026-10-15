-- Audio pipeline story 3 · spec §3 (revised 2026-10-16)
-- O1 Read/Listen modes, PDF content identity, O8 page skipping.

alter table public.books
  add column mode text not null default 'read' check (mode in ('read', 'listen')),
  add column content_sha256 text;

create index books_content_sha256_idx on public.books (content_sha256);

alter table public.user_books
  add column read_front_matter boolean not null default false;

-- A listener's departures from the default skip list (O8).
create table public.page_skip_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  page_number int not null check (page_number >= 1),
  skip boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id, page_number)
);

alter table public.page_skip_overrides enable row level security;
