-- Read/Listen per reader · spec O14 — a reader's own choice overrides the book's mode.
-- NULL = follow books.mode (the owner's mode, which every reader starts with once the book is shared).

alter table public.user_books add column mode text
  check (mode in ('read', 'listen'));
