-- A page counts toward the daily limit once EVER per user, book, page and voice (owner 2026-11-17).
-- Replaying a page in a voice already heard is free on any day; the same page in a new voice is new
-- audio and counts once. Rows from before this change have voice_hash NULL: heard in any voice.
-- usage_date stays: it is the day the page was first heard, and today's count reads it.
-- Run in the Supabase dashboard SQL editor (drops a constraint; the MCP declines it).

begin;

alter table public.daily_page_usage add column voice_hash text;

alter table public.daily_page_usage drop constraint daily_page_usage_pkey;

-- Old rows may repeat a page on different days; keep the earliest so "heard" stays one row.
delete from public.daily_page_usage d
 using public.daily_page_usage e
 where d.voice_hash is null and e.voice_hash is null
   and d.user_id = e.user_id and d.book_id = e.book_id and d.page_number = e.page_number
   and (e.first_listened_at, e.usage_date) < (d.first_listened_at, d.usage_date);

create unique index daily_page_usage_heard_key
  on public.daily_page_usage (user_id, book_id, page_number, coalesce(voice_hash, ''));

create index daily_page_usage_user_day_idx on public.daily_page_usage (user_id, usage_date);

drop function public.record_page_listen(uuid, uuid, int);

create function public.record_page_listen(p_user uuid, p_book uuid, p_page int, p_voice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_plan text;
  v_limit int;
  v_used int;
begin
  -- Serialise per user so two pages started at once cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select p.id, p.daily_page_limit into v_plan, v_limit
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.user_id = p_user and s.status = 'active' and (s.ends_at is null or s.ends_at > now());
  if not found then
    select id, daily_page_limit into v_plan, v_limit from public.plans where id = 'free';
  end if;

  select count(*) into v_used from public.daily_page_usage where user_id = p_user and usage_date = v_today;

  -- Heard before in this voice (any day), or before voices were recorded: free.
  if exists (select 1 from public.daily_page_usage
              where user_id = p_user and book_id = p_book and page_number = p_page
                and (voice_hash = p_voice or voice_hash is null)) then
    return jsonb_build_object('allowed', true, 'counted', false, 'used', v_used, 'limit', v_limit, 'plan', v_plan);
  end if;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'counted', false, 'used', v_used, 'limit', v_limit, 'plan', v_plan);
  end if;

  insert into public.daily_page_usage (user_id, usage_date, book_id, page_number, voice_hash)
  values (p_user, v_today, p_book, p_page, p_voice);

  return jsonb_build_object('allowed', true, 'counted', true, 'used', v_used + 1, 'limit', v_limit, 'plan', v_plan);
end;
$$;

revoke all on function public.record_page_listen(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.record_page_listen(uuid, uuid, int, text) to service_role;

commit;
