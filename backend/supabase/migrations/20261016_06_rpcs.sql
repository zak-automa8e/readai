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

-- Write one ledger row and move the cached balance in the same transaction.
create or replace function public.credit_apply(
  p_user uuid,
  p_kind text,
  p_amount bigint,
  p_unit text default null,
  p_quantity numeric default null,
  p_provider_cost bigint default null,
  p_reservation uuid default null,
  p_ref_type text default null,
  p_ref_id uuid default null,
  p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_kind in ('grant', 'release', 'rebate', 'refund') and p_amount < 0 then
    raise exception 'credit_apply: % must be positive', p_kind;
  end if;
  if p_kind in ('reserve', 'charge') and p_amount > 0 then
    raise exception 'credit_apply: % must be negative', p_kind;
  end if;

  insert into public.credit_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance_micros into v_balance from public.credit_accounts where user_id = p_user for update;

  if p_kind in ('reserve', 'charge') and v_balance + p_amount < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using detail = v_balance::text;
  end if;

  insert into public.credit_ledger
    (user_id, kind, amount_micros, unit, quantity, provider_cost_micros, reservation_id, ref_type, ref_id, note)
  values
    (p_user, p_kind, p_amount, p_unit, p_quantity, p_provider_cost, p_reservation, p_ref_type, p_ref_id, p_note);

  update public.credit_accounts
     set balance_micros = v_balance + p_amount, updated_at = now()
   where user_id = p_user
  returning balance_micros into v_balance;

  return v_balance;
end;
$$;

-- Pay back a funder up to what they paid (O6). Returns the amount actually rebated.
create or replace function public.apply_rebate(
  p_subject text,          -- 'extraction' | 'recording'
  p_subject_id uuid,
  p_funder uuid,
  p_amount bigint,
  p_ref_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid bigint;
  v_recovered bigint;
  v_rebate bigint;
begin
  if p_funder is null or p_amount <= 0 then
    return 0;
  end if;

  if p_subject = 'extraction' then
    select paid_micros, recovered_micros into v_paid, v_recovered
      from public.extraction_funders where extraction_id = p_subject_id and user_id = p_funder for update;
  elsif p_subject = 'recording' then
    select paid_micros, recovered_micros into v_paid, v_recovered
      from public.recording_funders where recording_id = p_subject_id and user_id = p_funder for update;
  else
    raise exception 'apply_rebate: unknown subject %', p_subject;
  end if;

  if not found then
    return 0;
  end if;

  v_rebate := least(p_amount, v_paid - v_recovered);
  if v_rebate <= 0 then
    return 0;
  end if;

  if p_subject = 'extraction' then
    update public.extraction_funders set recovered_micros = recovered_micros + v_rebate
     where extraction_id = p_subject_id and user_id = p_funder;
  else
    update public.recording_funders set recovered_micros = recovered_micros + v_rebate
     where recording_id = p_subject_id and user_id = p_funder;
  end if;

  perform public.credit_apply(p_funder, 'rebate', v_rebate, null, null, null, null, 'segment_audio', p_ref_id, p_subject);
  return v_rebate;
end;
$$;

-- Charge a listener for one clip at its total price (audio + text share), once, and pay funders forward.
-- Also used right after a clip is generated: the generator funded the audio, so only the text share is charged.
create or replace function public.charge_playback(
  p_listener uuid,
  p_segment_audio uuid,
  p_segment uuid,
  p_rebate_share numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audio public.segment_audio%rowtype;
  v_rec public.recordings%rowtype;
  v_seg public.segments%rowtype;
  v_source_book uuid;
  v_audio_part bigint := 0;
  v_text_part bigint := 0;
  v_rebated bigint := 0;
  v_share bigint;
  v_allocated bigint := 0;
  v_parts int;
  v_i int := 0;
  v_page_funder uuid;
  v_text_rebates jsonb := '[]';
  r record;
begin
  select * into v_audio from public.segment_audio where id = p_segment_audio;
  if not found or v_audio.status <> 'ready' then
    raise exception 'AUDIO_NOT_READY';
  end if;

  select * into v_rec from public.recordings where id = v_audio.recording_id;
  if v_rec.taken_down_at is not null then
    raise exception 'RECORDING_TAKEN_DOWN';
  end if;
  if v_rec.visibility = 'donated' then
    return jsonb_build_object('charged', 0, 'reason', 'donated');
  end if;

  select * into v_seg from public.segments where id = p_segment;
  if not found or v_seg.text_sha256 <> v_audio.text_sha256 then
    raise exception 'SEGMENT_AUDIO_MISMATCH';
  end if;
  select source_book_id into v_source_book from public.book_extractions where id = v_seg.extraction_id;

  -- Claim the entitlement first so a concurrent call cannot charge twice.
  insert into public.audio_entitlements (user_id, segment_audio_id) values (p_listener, p_segment_audio)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('charged', 0, 'reason', 'entitled');
  end if;

  if v_audio.funded_by_user_id is distinct from p_listener then
    v_audio_part := coalesce(v_audio.price_micros, 0);
  end if;

  -- Text share by characters per page; the last part takes the rounding remainder.
  v_parts := jsonb_array_length(v_seg.parts);
  for r in select (p ->> 'page')::int as page, (p ->> 'chars')::int as chars
             from jsonb_array_elements(v_seg.parts) p loop
    v_i := v_i + 1;
    v_share := case when v_i = v_parts then v_seg.text_price_micros - v_allocated
                    else v_seg.text_price_micros * r.chars / greatest(v_seg.char_count, 1) end;
    v_allocated := v_allocated + v_share;

    select pt.funded_by_user_id into v_page_funder
      from public.page_text pt join public.pages pg on pg.id = pt.page_id
     where pg.book_id = v_source_book and pg.page_number = r.page;

    if v_share > 0 and v_page_funder is distinct from p_listener then
      v_text_part := v_text_part + v_share;
      v_text_rebates := v_text_rebates || jsonb_build_object('funder', v_page_funder, 'amount', v_share);
    end if;
  end loop;

  if v_audio_part > 0 then
    perform public.credit_apply(p_listener, 'charge', -v_audio_part, 'audio_seconds', v_audio.duration_seconds,
                                null, null, 'segment_audio', p_segment_audio, 'audio');
  end if;
  if v_text_part > 0 then
    perform public.credit_apply(p_listener, 'charge', -v_text_part, 'tokens', null,
                                null, null, 'segment_audio', p_segment_audio, 'text share');
  end if;

  update public.audio_entitlements set paid_micros = v_audio_part + v_text_part
   where user_id = p_listener and segment_audio_id = p_segment_audio;

  if v_audio_part > 0 then
    v_rebated := v_rebated + public.apply_rebate('recording', v_rec.id, v_audio.funded_by_user_id,
                                                 floor(v_audio_part * p_rebate_share)::bigint, p_segment_audio);
  end if;
  for r in select (x ->> 'funder')::uuid as funder, (x ->> 'amount')::bigint as amount
             from jsonb_array_elements(v_text_rebates) x loop
    v_rebated := v_rebated + public.apply_rebate('extraction', v_seg.extraction_id, r.funder,
                                                 floor(r.amount * p_rebate_share)::bigint, p_segment_audio);
  end loop;

  return jsonb_build_object('charged', v_audio_part + v_text_part, 'audio', v_audio_part,
                            'text', v_text_part, 'rebated', v_rebated);
end;
$$;

revoke all on function public.claim_jobs(text, text[], int) from public, anon, authenticated;
revoke all on function public.credit_apply(uuid, text, bigint, text, numeric, bigint, uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.apply_rebate(text, uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.charge_playback(uuid, uuid, uuid, numeric) from public, anon, authenticated;

grant execute on function public.claim_jobs(text, text[], int) to service_role;
grant execute on function public.credit_apply(uuid, text, bigint, text, numeric, bigint, uuid, text, uuid, text)
  to service_role;
grant execute on function public.apply_rebate(text, uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.charge_playback(uuid, uuid, uuid, numeric) to service_role;
