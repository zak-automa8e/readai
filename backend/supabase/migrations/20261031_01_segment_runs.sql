-- Listen-ahead extraction, story 2 (specs/2026-10-30-listen-ahead-extraction.md): paragraphs can start
-- on any page. Text arrives a few pages at a time wherever listeners are, so the done pages of an
-- extraction form runs anywhere in the book, not one prefix from page 1.

-- 'head': the first paragraph of a run whose previous page has no text yet (it may continue that page)
alter table public.segments drop constraint segments_status_check;
alter table public.segments add constraint segments_status_check
  check (status in ('open', 'final', 'head'));

alter table public.book_extractions
  add column built_runs jsonb not null default '[]'::jsonb,  -- [[first, last], ...] pages whose segments are built
  add column segment_version int not null default 0;         -- bumped by every replace_segments

-- Swap the segments starting on pages p_from_page..p_to_page for p_rows and record the built runs,
-- in one transaction. Rows keep their id when their seq survives (clients hold segment ids).
-- Compare-and-set on segment_version: a concurrent finaliser makes this raise, nothing is written.
create or replace function public.replace_segments(
  p_extraction uuid,
  p_from_page int,
  p_to_page int,
  p_rows jsonb,
  p_built_runs jsonb,
  p_expect_version int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version int;
begin
  update book_extractions
     set built_runs = p_built_runs, segment_version = segment_version + 1
   where id = p_extraction and segment_version = p_expect_version
  returning segment_version into v_version;
  if v_version is null then
    raise exception 'segment_version_conflict';
  end if;

  delete from segments s
   where s.extraction_id = p_extraction
     and s.start_page between p_from_page and p_to_page
     and s.seq not in (select (r ->> 'seq')::int from jsonb_array_elements(p_rows) r);

  insert into segments (extraction_id, seq, role, start_page, end_page, parts, text, text_sha256,
                        char_count, sentence_offsets, footnote_markers, status)
  select p_extraction, x.seq, x.role, x.start_page, x.end_page, x.parts, x.text, x.text_sha256,
         x.char_count, coalesce(x.sentence_offsets, '{}'), coalesce(x.footnote_markers, '{}'), x.status
    from jsonb_to_recordset(p_rows) as x(seq int, role text, start_page int, end_page int, parts jsonb,
         text text, text_sha256 text, char_count int, sentence_offsets int[], footnote_markers text[], status text)
  on conflict (extraction_id, seq) do update
     set role = excluded.role,
         start_page = excluded.start_page,
         end_page = excluded.end_page,
         parts = excluded.parts,
         text = excluded.text,
         text_sha256 = excluded.text_sha256,
         char_count = excluded.char_count,
         sentence_offsets = excluded.sentence_offsets,
         footnote_markers = excluded.footnote_markers,
         status = excluded.status;

  return v_version;
end;
$$;

revoke all on function public.replace_segments(uuid, int, int, jsonb, jsonb, int) from public, anon, authenticated;
grant execute on function public.replace_segments(uuid, int, int, jsonb, jsonb, int) to service_role;
