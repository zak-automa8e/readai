-- Audio pipeline story 6b · spec O13 — listen_followup jobs finish a listening window once the
-- paragraph it stopped at is closed by extraction. Replaces tts_chapter (chapter-ahead dropped, O13).

alter table public.book_processing_jobs drop constraint book_processing_jobs_kind_check;
alter table public.book_processing_jobs add constraint book_processing_jobs_kind_check
  check (kind in ('extract_pages', 'tts_segment', 'listen_followup'));
