// Sharing spec story 0 — move every uploaded PDF out of the public readai-media bucket into the
// private readai-pdfs bucket (same path), set books.pdf_path and clear books.pdf_url for uploads.
// Files are MOVED, not copied: the project is close to the free storage limit. Orphans (PDFs of
// deleted books) move too. Needs migration 20261102_00 applied first.
//
// Usage (from backend/):
//   node scripts/move-pdfs-private.js           dry run: lists what would move, changes nothing
//   node scripts/move-pdfs-private.js --apply   creates the bucket, moves the files, updates the books,
//                                               then checks every old public URL no longer opens

const config = require('../src/config');
const supabaseService = require('../src/services/supabaseService');

const apply = process.argv.includes('--apply');
const SOURCE = 'readai-media';
const TARGET = config.pdfs.bucket;
const PREFIX = 'pdfs';
const PUBLIC_MARKER = `/object/public/${SOURCE}/`;

// Every object under prefix, depth first (storage lists one folder level at a time)
async function listAll(storage, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) out.push(path);
      else out.push(...await listAll(storage, path));
    }
    if (data.length < 100) return out;
  }
}

const pathFromUrl = (url) => (url && url.includes(PUBLIC_MARKER) ? decodeURIComponent(url.split(PUBLIC_MARKER)[1].split('?')[0]) : null);

async function main() {
  supabaseService.checkInitialized();
  const db = supabaseService.adminClient;
  const source = db.storage.from(SOURCE);

  const files = await listAll(source, PREFIX);
  const { data: books, error } = await db.from('books').select('id, title, pdf_url, pdf_path').not('pdf_url', 'is', null);
  if (error) throw error;
  const uploads = books.map((b) => ({ ...b, path: pathFromUrl(b.pdf_url) })).filter((b) => b.path);
  const referenced = new Set(uploads.map((b) => b.path));

  console.log(`${files.length} PDF file(s) in ${SOURCE}/${PREFIX}, ${uploads.length} referenced by a book${apply ? '' : ' (dry run)'}`);
  for (const file of files) console.log(`${referenced.has(file) ? 'book ' : 'orphan'}  ${file}`);
  for (const book of uploads) {
    if (!files.includes(book.path)) console.log(`MISSING  ${book.id}  ${book.path}  (the book's file is not in storage)`);
  }
  if (!apply) return;

  const { data: buckets, error: bucketsError } = await db.storage.listBuckets();
  if (bucketsError) throw bucketsError;
  if (!buckets.some((b) => b.id === TARGET)) {
    const { error: createError } = await db.storage.createBucket(TARGET, { public: false, allowedMimeTypes: ['application/pdf'] });
    if (createError) throw createError;
    console.log(`created private bucket ${TARGET}`);
  }

  let moved = 0;
  for (const file of files) {
    const { error: moveError } = await source.move(file, file, { destinationBucket: TARGET });
    if (moveError) {
      console.log(`FAILED move  ${file}  ${moveError.message}`);
      continue;
    }
    moved++;
  }
  console.log(`moved ${moved}/${files.length}`);

  let updated = 0;
  for (const book of uploads) {
    const { data: exists } = await db.storage.from(TARGET).createSignedUrl(book.path, 60);
    if (!exists) {
      console.log(`skip book  ${book.id}  its file is not in ${TARGET}`);
      continue;
    }
    const { error: updateError } = await db.from('books').update({ pdf_path: book.path, pdf_url: null }).eq('id', book.id);
    if (updateError) throw updateError;
    updated++;
  }
  console.log(`updated ${updated}/${uploads.length} book(s)`);

  // The point of the move: no old public link opens any more
  let stillOpen = 0;
  for (const book of uploads) {
    const response = await fetch(book.pdf_url, { method: 'HEAD' });
    if (response.ok) stillOpen++;
    console.log(`old URL  HTTP ${response.status}  ${book.id}`);
  }
  console.log(stillOpen ? `WARNING: ${stillOpen} old public URL(s) still open` : 'every old public URL is closed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
