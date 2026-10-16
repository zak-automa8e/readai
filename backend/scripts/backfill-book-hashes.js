// Audio pipeline story 3 · spec §3.1 M4 — write books.content_sha256 (SHA-256 of the PDF bytes)
// for books that do not have it yet. Two uploads of the same PDF then share one extraction.
//
// Usage (from backend/):
//   node scripts/backfill-book-hashes.js           dry run: prints the hash for each book, writes nothing
//   node scripts/backfill-book-hashes.js --apply   writes the hashes

const crypto = require('crypto');
const supabaseService = require('../src/services/supabaseService');

const apply = process.argv.includes('--apply');

async function main() {
  supabaseService.checkInitialized();
  const db = supabaseService.adminClient;

  const { data: books, error } = await db
    .from('books')
    .select('id, title, pdf_url')
    .is('content_sha256', null);
  if (error) throw error;

  console.log(`${books.length} book(s) without a content hash${apply ? '' : ' (dry run)'}`);

  let written = 0;
  for (const book of books) {
    if (!book.pdf_url) {
      console.log(`skip  ${book.id}  no pdf_url`);
      continue;
    }

    const response = await fetch(book.pdf_url);
    if (!response.ok) {
      console.log(`skip  ${book.id}  download failed: HTTP ${response.status}`);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    console.log(`${hash}  ${book.id}  ${bytes.length} bytes  ${book.title}`);

    if (apply) {
      const { error: updateError } = await db.from('books').update({ content_sha256: hash }).eq('id', book.id);
      if (updateError) throw updateError;
      written += 1;
    }
  }

  if (apply) console.log(`wrote ${written} hash(es)`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
