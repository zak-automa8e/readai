// Fixtures shared by the extraction tests; requires the mocked supabaseService (fakeSupabase).
const db = require('../../src/services/supabaseService');
const fixtures = require('../fixtures/bakeoff-pages.json');

const BOOK = 'book-1';
const b3p9 = fixtures.books.find((b) => b.key === 'b3').pages.find((p) => p.page === 9);
const usage = (cost = 0.004) => ({ promptTokens: 2329, completionTokens: 700, reasoningTokens: 0, cachedTokens: 0, costUsd: cost, provider: 'openrouter', model: 'test/model-dated' });
const cleanPage = (n) => ({
  blocks: [
    { role: 'running_header', text: 'عنوان الكتاب' },
    { role: 'body', text: `نص الصفحة ${n} كاملا.`, starts_mid_sentence: false, ends_mid_sentence: false },
    { role: 'page_number', text: String(n) },
  ],
  pageType: 'body',
  usage: usage(),
});
const ctx = { updatePayload: jest.fn().mockResolvedValue(true) };

async function setupExtraction(total = 4) {
  db.reset();
  db.addBook({ id: BOOK, content_sha256: 'sha-1' });
  db.addPages(BOOK, total);
  const extraction = await db.createExtraction({ content_sha256: 'sha-1', source_book_id: BOOK, model: 'test/model', prompt_version: 2, started_by: 'user-1' });
  await db.updateExtraction(extraction.id, { pages_total: total, status: 'running' });
  return db.state.extractions.get(extraction.id);
}

function chunkJob(extraction, pages, phase = 'realtime', extra = {}) {
  return { id: 'job-chunk', kind: 'extract_pages', book_id: BOOK, user_id: 'user-1', extraction_id: extraction.id, attempts: 1, max_attempts: 5, payload: { phase, pages, ...extra } };
}

module.exports = { BOOK, b3p9, usage, cleanPage, ctx, setupExtraction, chunkJob };
