-- Audio pipeline story 3 · spec §3 (revised 2026-10-16, O12)
-- Content-addressed clip cache: one clip per paragraph text × voice snapshot, shared by every listener.

create table public.segment_audio (
  id uuid primary key default gen_random_uuid(),
  text_sha256 text not null,
  voice_snapshot_sha256 text not null,
  voice_snapshot jsonb not null,             -- {model, base_voice, instructions}; a persona edit is a new hash
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  audio_url text,
  audio_format text,
  sample_rate int,
  channels int,
  duration_seconds numeric(8, 2),
  size_bytes int,
  usage jsonb,
  cost_micros bigint,                        -- our provider cost, micro-USD
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  check (status <> 'ready' or (audio_url is not null and duration_seconds is not null)),
  unique (text_sha256, voice_snapshot_sha256)
);

create index segment_audio_status_idx on public.segment_audio (status, created_at);

alter table public.segment_audio enable row level security;
