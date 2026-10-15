-- Audio pipeline story 3 · spec §3 + §5 — functions called by the backend with the service key only.

-- Claim up to p_n runnable jobs. A running job whose lease is older than 5 minutes is claimable again.
create or replace function public.claim_jobs(p_worker text, p_kinds text[], p_n int)
returns setof public.book_processing_jobs
language sql
security definer
set search_path = public
as $$
  update public.book_processing_jobs j
     set status = 'running', locked_by = p_worker, locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id
       from public.book_processing_jobs
      where kind = any (p_kinds)
        and ((status = 'queued' and run_after <= now())
          or (status = 'running' and locked_at < now() - interval '5 minutes'))
      order by priority, created_at
      limit p_n
      for update skip locked)
  returning j.*;
$$;

-- Count a page toward today's limit (O12). Already counted today ⇒ allowed without counting again.
create or replace function public.record_page_listen(p_user uuid, p_book uuid, p_page int)
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

  if exists (select 1 from public.daily_page_usage
              where user_id = p_user and usage_date = v_today and book_id = p_book and page_number = p_page) then
    return jsonb_build_object('allowed', true, 'counted', false, 'used', v_used, 'limit', v_limit, 'plan', v_plan);
  end if;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'counted', false, 'used', v_used, 'limit', v_limit, 'plan', v_plan);
  end if;

  insert into public.daily_page_usage (user_id, usage_date, book_id, page_number)
  values (p_user, v_today, p_book, p_page);

  return jsonb_build_object('allowed', true, 'counted', true, 'used', v_used + 1, 'limit', v_limit, 'plan', v_plan);
end;
$$;

revoke all on function public.claim_jobs(text, text[], int) from public, anon, authenticated;
revoke all on function public.record_page_listen(uuid, uuid, int) from public, anon, authenticated;

grant execute on function public.claim_jobs(text, text[], int) to service_role;
grant execute on function public.record_page_listen(uuid, uuid, int) to service_role;
