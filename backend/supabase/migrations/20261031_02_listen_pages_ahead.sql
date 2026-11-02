-- "Prepare ahead" setting · listen-ahead spec story 3 — read pages of audio prepared past the listener
-- (text runs one page more). Every existing profile starts at the default.

alter table public.user_profiles add column listen_pages_ahead int not null default 2
  check (listen_pages_ahead between 1 and 5);
