-- Audio pipeline story 3 · spec §3 + §5 — the job queue, claimed through claim_jobs (06).

create table public.book_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('extract_pages', 'tts_segment', 'tts_chapter')),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  extraction_id uuid references public.book_extractions (id) on delete cascade,
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  priority int not null default 100,         -- lower runs first
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index book_processing_jobs_claim_idx on public.book_processing_jobs (status, run_after, priority);
create index book_processing_jobs_book_idx on public.book_processing_jobs (book_id, kind);

alter table public.book_processing_jobs enable row level security;
