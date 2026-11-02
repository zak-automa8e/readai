# Book sharing + Discover

Epic proposed 2026-11-02. Builds on O14 (2026-10-30): public sharing first, chosen-people sharing later, no review step,
mode per reader (`user_books.mode` overrides `books.mode`), audio kept.

## 1. Owner decisions

| # | Decision |
|---|---|
| S1 | Making a book private again takes it off Discover; readers who already added it keep it. Deleting the book removes it for everyone (FK cascades already do this). |
| S2 | One category per public book, from a fixed list: Fiction, Non-fiction, Religion, History, Science, Self-help, Children, Education, Other. Chosen in the Share dialog; required to go public. |
| S3 | Copyright: an "I have the right to share this book" checkbox, required to go public, timestamped. A "Report" action on Discover only records the report (table + log). No review queue. |
| S4 | Ratings: 1-5 stars plus an optional written review, one per reader, changeable and removable. |
| S5 | PDFs are private. A book's content (PDF, and from story 3 its text and audio) opens for the owner, and for a reader who has it in their library **while it is public**. After the owner makes it private, other readers keep the library entry, notes and progress, and see "The owner made this book private." (narrows S1). |
| S6 | Only the owner can download the PDF. Readers of a public book read it in the app through short-lived links; a reader's device still receives the file, so this stops casual downloading, not a determined one. |

Defaults I chose (say if any is wrong): the owner cannot rate their own book; a reader must have the book in their
library to rate it; reviews are up to 1,000 characters, plain text; reports are for books only (not reviews) in v1.

## 2. Target shape

```
Library card (owner)  ── Share ──▶ ShareDialog ── PUT /books/:id/sharing ──▶ books.visibility / category / shared_at
                                                                          └▶ rights_confirmed_at
Discover ── GET /books/public?search&category&sort ──▶ cards (stars, category, "Shared by")
   └─ card ─▶ BookDetailSheet ── GET /books/public/:id ──▶ description + reviews
                 ├─ Add to library ── POST /books/:id/add-to-library  (public or owner only)
                 ├─ Open           ── /reader/:id (reader's own mode, progress, notes, chat)
                 ├─ Your rating    ── PUT|DELETE /books/:id/rating
                 └─ Report         ── POST /books/:id/report
Library card (reader) ── Remove from library ── DELETE /books/:id  (drops the reader's row only; exists)
```

Audio and text are already shared by content hash and voice, so a public book's clips serve every listener. A page
still counts toward each listener's own daily limit when they hear it.

## 3. Data model

| Change | Migration | Why |
|---|---|---|
| `books.category text` with check in the 9 slugs (`fiction`, `non_fiction`, `religion`, `history`, `science`, `self_help`, `children`, `education`, `other`) | `20261102_01_book_sharing.sql` | S2 |
| `books.shared_at timestamptz`, `books.rights_confirmed_at timestamptz` | same | S3; `shared_at` orders "Newest" on Discover |
| `book_reports (id, book_id → books cascade, reporter_id, reason text check in ('copyright','inappropriate','broken','other'), note text ≤ 500, created_at)`, unique `(book_id, reporter_id)` | same | S3 |
| `book_ratings (id, book_id → books cascade, user_id, rating int check 1-5, review text ≤ 1000, created_at, updated_at)`, unique `(book_id, user_id)` | `20261102_02_book_ratings.sql` (story 4) | S4; mirrors `persona_ratings` |
| view `book_rating_stats (book_id, rating_avg, rating_count)` | same | Discover cards and "Top rated" sort |

All additive (no DROP / UPDATE / DELETE), so both can go through the Supabase MCP after an approval card.
RLS on, no policies needed beyond service role (the backend reads with the service key and checks ownership in code).

## 4. Stories

Gates for every story: `cd backend && npm test`, `cd frontend && npx tsc --noEmit -p tsconfig.app.json && npm run
build`. Backend lint stays broken (no ESLint config) and is not a gate.

### Story 0 — Private PDFs (M) · ships first, closes a live exposure

Today every uploaded PDF is a permanent public URL in the public `readai-media` bucket (`pdfs/`, 19 files: 5 books
plus 14 left behind by deleted books), the browser sends that URL to chat, and `GET /api/pdf-proxy` fetches any URL
for anyone without sign-in (unused by the frontend).

Backend:
- Private bucket `readai-pdfs`; column `books.pdf_path text` (`20261102_00_private_pdfs.sql`). Upload writes there
  and sets `pdf_path`, `pdf_url` null. A book added from an external link keeps its `pdf_url` (the uploader's link).
- `services/pdfAccess.js`: `canRead(userId, book)` = owner, or public and in the reader's library (S5);
  `canDownload` = owner (S6); `linkFor(book, {download})` = a signed URL (600 s; download sets the file name) or the
  external link. `bytesFor(book)` for the server's own use (service key).
- `GET /api/books/:id/pdf?download=1` → `{ url, expiresAt }`; 403 `PDF_PRIVATE` for a reader of an un-shared book,
  403 `DOWNLOAD_OWNER_ONLY` for download by a non-owner.
- Extraction (`pdfSource`), thumbnails and chat read through `bytesFor`; chat stops taking `pdfUrl` from the client.
- `GET /api/pdf-proxy` is removed.
- Data step `scripts/move-pdfs-private.js` (dry run by default, `--apply`): creates the bucket, **moves** (not copies;
  the project is at ~958 MB of the free 1 GB) every `pdfs/*` object to `readai-pdfs`, sets `pdf_path` and clears
  `pdf_url` on the 5 books. The 14 orphans move too; deleting them is a separate call.

Frontend:
- `usePdfDocument` asks `/books/:id/pdf` for the link (and again after a load failure); react-pdf loads the whole
  file at once (`disableRange`) so the link may expire after loading. `BooksContext` stops probing `pdf_url`.
- Owner's Library card gains "Download PDF". The page shows "The owner made this book private." on `PDF_PRIVATE`.

Acceptance criteria:
- [ ] Every old public PDF URL stops working (checked by the script after `--apply`).
- [ ] The owner reads and downloads; another user gets 403 for a private book, and 403 for downloading a public one.
- [ ] Extraction, the cover thumbnail and chat still work on a moved book.

### Story 1 — Share publicly (M)

Backend:
- Migration `20261102_01` (category, shared_at, rights_confirmed_at, book_reports).
- `PUT /api/books/:id/sharing` `{ visibility: 'public'|'private', category?, rightsConfirmed? }`, owner only (403
  otherwise). Going public requires a valid category and `rightsConfirmed === true` (400 with a field code); sets
  `shared_at` (first time only) and `rights_confirmed_at`. Going private keeps category and timestamps.
- Security fix: `POST /books/:id/add-to-library` accepts only a public book or the caller's own (403 otherwise).
- Mode rule (O14): `bookModeService.setMode` writes `books.mode` only while the owner is the book's only reader;
  once anyone else has it (public or after going private again, S1), the owner's switch writes their own
  `user_books.mode`. Today the rule is "private", which would let an un-shared book's owner change other readers'
  starting mode.

Frontend:
- `ShareDialog` replaces the "coming soon" toast on the owner's Library card: Public switch, category select,
  rights checkbox, "Make public" / "Make private". A public book shows a small globe mark on its card.

Acceptance criteria:
- [ ] Owner makes a book public with a category and the checkbox; it is refused without either.
- [ ] A non-owner gets 403 on `/sharing`; adding a private book someone else owns is 403.
- [ ] After another reader adds the book, the owner's Read/Listen switch changes only the owner's own mode.

### Story 2 — Discover from real data (M)

Backend:
- `GET /api/books/public` rewritten: optional auth; `search` (title/author/description, escaped for `ilike`),
  `category`, `sort=newest|top`, `page`, `limit ≤ 50`. Drops the stale `processing_status='completed'` filter.
  Each item: id, title, author, description, thumbnailUrl, totalPages, category, mode (the starting mode),
  sharedBy (display name), sharedAt, ratingAvg, ratingCount, inLibrary (false when signed out).
- `GET /api/books/public/:id`: the same fields for one public book (404 when private).

Frontend:
- `Discover.tsx` loses the mock data: search box (debounced), category chips, sort (Newest / Top rated), card grid,
  empty and error states, "Load more". `BookDetailSheet` opens from a card: cover, description, category, Read or
  Listen start mark, "Add to library" or "Open" when already added. Split into `components/discover/`.

Acceptance criteria:
- [ ] A book made public in story 1 appears on Discover within one reload; made private, it disappears.
- [ ] Search and category filter combine; "Top rated" orders by average then count.
- [ ] Add to library → the book is in the Library and opens in the starting mode; "Open" shows from then on.

### Story 3 — Shared books in the reader's library (S)

- `GET /books/library` items carry `isOwner` and `sharedBy`.
- Reader's card: "Shared by {name}", actions Open and Remove from library only (Edit, Share, Delete hidden); the
  existing delete handler already removes only the reader's row.
- Reader's own progress, notes, chat, mode and listening position work on a shared book (spot-check; they are keyed by
  user already).
- S5 for text and audio: `/segments`, `/listen`, `/process` and clip URLs use `pdfAccess.canRead`; notes and progress
  keep the looser library check, so an un-shared book's reader still sees their notes.

Acceptance criteria:
- [ ] A reader removing a shared book leaves it in the owner's library and on Discover.
- [ ] The owner making it private keeps it in the reader's library (S1); deleting it removes it for both.

### Story 4 — Ratings and reviews (M)

Backend:
- Migration `20261102_02` (book_ratings + book_rating_stats).
- `PUT /api/books/:id/rating` `{ rating, review? }`: caller has the book in their library, is not the owner, rating
  1-5 integer, review ≤ 1,000 chars after trim (empty = none). `DELETE` removes it.
- `GET /api/books/public/:id/reviews?page`: newest first, reviewer display name, rating, review, updatedAt; plus the
  caller's own rating when signed in.

Frontend:
- Stars on Discover cards (average + count). In `BookDetailSheet`: the reviews list and "Your rating" (stars + text,
  Save, Remove), shown only once the book is in the reader's library and they are not the owner.

Acceptance criteria:
- [ ] Rating, changing and removing it updates the card's average and count.
- [ ] The owner and readers without the book cannot rate (403); out-of-range values are 400.

### Story 5 — Report a book (S)

- `POST /api/books/:id/report` `{ reason, note? }` on a public book; one report per reader per book (a second one
  updates it); `logger.warn` with book and reason. No admin UI: reports are read in the Supabase dashboard.
- "Report" in `BookDetailSheet` → small dialog with the four reasons and an optional note.

Acceptance criteria:
- [ ] A report is stored once per reader; a private book cannot be reported (404).

## 5. Order and risks

Order 0 → 1 → 2 → 3 → 4 → 5; stories 0 and 1 carry the access fixes, so they ship first even if Discover waits.

- Segment and legacy page audio stay in the public bucket under unguessable paths; the app only hands a clip URL out
  after the access check, but a handed-out URL does not expire. Signed audio URLs would be their own story.
- Cover thumbnails stay public (they are shown on Discover).
- Chosen-people sharing (`books.shared_with`) and a review queue for reports stay out of scope (O14).
