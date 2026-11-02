-- Private PDFs · sharing spec story 0 — an uploaded PDF's path in the private readai-pdfs bucket.
-- NULL for a book added from a link (it keeps books.pdf_url). scripts/move-pdfs-private.js moves
-- the existing files and fills this column; the bucket itself is created by that script.

alter table public.books add column pdf_path text;
