-- Audio pipeline story 3 · spec §3 (revised 2026-10-16)
-- One versioned extraction per PDF content; per-page blocks and cost; segments (the playback unit).

create table public.book_extractions (
  id uuid primary key default gen_random_uuid(),
  content_sha256 text not null,
  source_book_id uuid not null references public.books (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'partial', 'complete', 'failed')),
  model text not null,
  prompt_version int not null,
  dpi int not null default 200,
  pages_total int,
  pages_done int not null default 0,
  pages_failed int not null default 0,
  finalized_through_page int not null default 0,
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

-- One live extraction per recipe for the same PDF content.
create unique index book_extractions_live_recipe_key
  on public.book_extractions (content_sha256, prompt_version, model)
  where status <> 'failed';
create index book_extractions_source_book_idx on public.book_extractions (source_book_id, created_at desc);

alter table public.book_extractions enable row level security;

alter table public.page_text
  add column blocks jsonb,
  add column page_type text check (page_type in (
    'cover', 'title', 'copyright', 'dedication', 'author_note', 'toc', 'blank',
    'preface', 'introduction', 'body', 'index', 'bibliography', 'back_cover')),
  add column extraction_id uuid references public.book_extractions (id) on delete set null,
  add column prompt_version int,
  add column model text,
  add column image_sha256 text,
  add column validation jsonb,
  add column usage jsonb,
  add column cost_micros bigint;             -- our provider cost for this page, micro-USD

create index page_text_extraction_idx on public.page_text (extraction_id);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.book_extractions (id) on delete cascade,
  seq int not null check (seq >= 1),
  role text not null check (role in ('body', 'heading')),
  start_page int not null,
  end_page int not null,
  parts jsonb not null,                       -- [{page, chars}]; owned by start_page (O7)
  text text not null,
  text_sha256 text not null,
  char_count int not null check (char_count >= 0),
  sentence_offsets int[] not null default '{}',
  footnote_markers text[] not null default '{}',
  status text not null default 'final' check (status in ('open', 'final')),
  created_at timestamptz not null default now(),
  check (end_page >= start_page),
  unique (extraction_id, seq)
);

create index segments_extraction_page_idx on public.segments (extraction_id, start_page);
create index segments_text_sha256_idx on public.segments (text_sha256);

alter table public.segments enable row level security;
