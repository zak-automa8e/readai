-- Audio pipeline story 3 · spec §3 (revised 2026-10-16)
-- O4 recordings (PDF content × voice snapshot), O5 donation, O6 funders, replay entitlements.

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  content_sha256 text not null,
  voice_snapshot_sha256 text not null,
  voice_snapshot jsonb not null,             -- {model, base_voice, instructions}; a persona edit is a new hash
  persona_id uuid references public.voice_personas (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,   -- founding narrator
  visibility text not null default 'private' check (visibility in ('private', 'donated')),
  donated_at timestamptz,
  rights_attested_at timestamptz,
  taken_down_at timestamptz,
  takedown_reason text,
  created_at timestamptz not null default now(),
  check (visibility = 'private' or rights_attested_at is not null),
  unique (content_sha256, voice_snapshot_sha256)
);

alter table public.recordings enable row level security;

-- One clip of one recording, found by text hash so unchanged paragraphs survive a re-extraction.
create table public.segment_audio (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  text_sha256 text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  audio_url text,
  audio_format text,
  sample_rate int,
  channels int,
  duration_seconds numeric(8, 2),
  size_bytes int,
  funded_by_user_id uuid references auth.users (id) on delete set null,
  cost_micros bigint,                        -- provider cost of the audio
  price_micros bigint,                       -- audio price; the text share lives on segments
  usage jsonb,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  check (status <> 'ready' or (audio_url is not null and duration_seconds is not null)),
  unique (recording_id, text_sha256)
);

create index segment_audio_status_idx on public.segment_audio (status, created_at);

alter table public.segment_audio enable row level security;

-- What each user paid for this recording's audio and has recovered through rebates (O6, audio part).
create table public.recording_funders (
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  paid_micros bigint not null default 0 check (paid_micros >= 0),
  recovered_micros bigint not null default 0 check (recovered_micros >= 0),
  check (recovered_micros <= paid_micros),
  primary key (recording_id, user_id)
);

alter table public.recording_funders enable row level security;

-- Pay once, replay free.
create table public.audio_entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  segment_audio_id uuid not null references public.segment_audio (id) on delete cascade,
  paid_micros bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, segment_audio_id)
);

alter table public.audio_entitlements enable row level security;
