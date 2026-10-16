// In-memory stand-in for the supabaseService methods the extraction pipeline uses.
// Mirrors the constraints that matter: page_text.page_id unique, segments unique (extraction_id, seq),
// one live extraction per (content, prompt version, model), job idempotency_key unique.
function createFakeSupabase() {
  let ids = 0;
  const nextId = (prefix) => `${prefix}-${++ids}`;
  const state = {};

  const fake = {
    initialized: true,
    state,

    reset() {
      ids = 0;
      Object.assign(state, {
        books: new Map(),
        userBooks: [],
        extractions: new Map(),
        pages: [],
        pageTexts: new Map(),
        segments: [],
        jobs: [],
        costs: [],
        files: new Map(),
        failNextExtractionUpdate: false,
      });
    },

    // ---- helpers for tests
    addBook(book) {
      const row = { mode: 'listen', total_pages: null, content_sha256: null, pdf_url: 'https://example.test/book.pdf', user_id: 'user-1', ...book };
      state.books.set(row.id, row);
      return row;
    },
    addPages(bookId, total) {
      for (let n = 1; n <= total; n++) state.pages.push({ id: `page-${bookId}-${n}`, book_id: bookId, page_number: n });
    },
    pageId(bookId, n) {
      return state.pages.find((p) => p.book_id === bookId && p.page_number === n).id;
    },
    landPage(extraction, bookId, n, { blocks, pageType = null }) {
      const pageId = fake.pageId(bookId, n);
      state.pageTexts.set(pageId, {
        page_id: pageId,
        extraction_id: extraction.id,
        prompt_version: extraction.prompt_version,
        model: extraction.model,
        blocks,
        page_type: pageType,
        validation: { spokenChars: 100 },
      });
    },
    segmentsOf(extractionId) {
      return state.segments.filter((s) => s.extraction_id === extractionId).sort((a, b) => a.seq - b.seq);
    },

    // ---- supabaseService surface
    getBookById: jest.fn(async (id) => {
      const book = state.books.get(id);
      if (!book) throw Object.assign(new Error('not found'), { code: 'PGRST116' });
      return { ...book };
    }),
    updateBook: jest.fn(async (id, updates) => {
      Object.assign(state.books.get(id), updates);
      return { ...state.books.get(id) };
    }),
    ensureUserHasBookAccess: jest.fn(async (userId, bookId) => {
      const book = state.books.get(bookId);
      return Boolean(book && (book.user_id === userId || state.userBooks.some((u) => u.user_id === userId && u.book_id === bookId)));
    }),
    getUserBook: jest.fn(async (userId, bookId) => state.userBooks.find((u) => u.user_id === userId && u.book_id === bookId) || null),

    getLiveExtraction: jest.fn(async (sha, promptVersion, model) => {
      const rows = [...state.extractions.values()].filter((e) => e.content_sha256 === sha
        && e.prompt_version === promptVersion && e.model === model && e.status !== 'failed');
      return rows.length ? { ...rows[rows.length - 1] } : null;
    }),
    getExtractionById: jest.fn(async (id) => (state.extractions.has(id) ? { ...state.extractions.get(id) } : null)),
    createExtraction: jest.fn(async (row) => {
      const clash = [...state.extractions.values()].some((e) => e.content_sha256 === row.content_sha256
        && e.prompt_version === row.prompt_version && e.model === row.model && e.status !== 'failed');
      if (clash) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      const extraction = {
        id: nextId('ext'),
        status: 'queued',
        dpi: 200,
        pages_total: null,
        pages_done: 0,
        pages_failed: 0,
        finalized_through_page: 0,
        started_at: null,
        finished_at: null,
        error: null,
        ...row,
      };
      state.extractions.set(extraction.id, extraction);
      return { ...extraction };
    }),
    updateExtraction: jest.fn(async (id, updates, { expectFinalizedThrough } = {}) => {
      if (state.failNextExtractionUpdate) {
        state.failNextExtractionUpdate = false;
        throw new Error('simulated crash before the extraction update');
      }
      const row = state.extractions.get(id);
      if (!row) return null;
      if (expectFinalizedThrough !== undefined && row.finalized_through_page !== expectFinalizedThrough) return null;
      Object.assign(row, updates);
      return { ...row };
    }),

    getPageIdMap: jest.fn(async (bookId, from, to) => new Map(state.pages
      .filter((p) => p.book_id === bookId && p.page_number >= from && p.page_number <= to)
      .map((p) => [p.page_number, p.id]))),
    insertPagesBulk: jest.fn(async (bookId, total) => {
      let added = 0;
      for (let n = 1; n <= total; n++) {
        if (!state.pages.some((p) => p.book_id === bookId && p.page_number === n)) {
          state.pages.push({ id: `page-${bookId}-${n}`, book_id: bookId, page_number: n });
          added += 1;
        }
      }
      return added;
    }),
    getPageTextsByPageIds: jest.fn(async (pageIds) => pageIds.filter((id) => state.pageTexts.has(id)).map((id) => ({ ...state.pageTexts.get(id) }))),
    upsertPageTextBlocks: jest.fn(async (pageId, fields) => {
      state.pageTexts.set(pageId, { ...(state.pageTexts.get(pageId) || {}), page_id: pageId, ...fields });
      return { id: `pt-${pageId}`, page_id: pageId };
    }),
    attachPageTextToExtraction: jest.fn(async (pageId, extractionId) => {
      state.pageTexts.get(pageId).extraction_id = extractionId;
    }),
    pageNumberOf(pageId) {
      return state.pages.find((p) => p.id === pageId).page_number;
    },
    getDonePageNumbers: jest.fn(async (extractionId, after = 0) => [...state.pageTexts.values()]
      .filter((t) => t.extraction_id === extractionId)
      .map((t) => fake.pageNumberOf(t.page_id))
      .filter((n) => n > after)
      .sort((a, b) => a - b)),
    countDonePages: jest.fn(async (extractionId) => [...state.pageTexts.values()].filter((t) => t.extraction_id === extractionId).length),
    getPageBlocksRange: jest.fn(async (extractionId, from, to) => [...state.pageTexts.values()]
      .filter((t) => t.extraction_id === extractionId)
      .map((t) => ({ page: fake.pageNumberOf(t.page_id), blocks: t.blocks || [], pageType: t.page_type || null }))
      .filter((p) => p.page >= from && p.page <= to)
      .sort((a, b) => a.page - b.page)),
    getSpokenCharSample: jest.fn(async () => []),

    getLastSegment: jest.fn(async (extractionId) => {
      const rows = fake.segmentsOf(extractionId);
      return rows.length ? { ...rows[rows.length - 1] } : null;
    }),
    upsertSegments: jest.fn(async (rows) => {
      for (const row of rows) {
        const existing = state.segments.find((s) => s.extraction_id === row.extraction_id && s.seq === row.seq);
        if (existing) Object.assign(existing, row);
        else state.segments.push({ id: nextId('seg'), ...row });
      }
    }),
    getSegments: jest.fn(async (extractionId, { fromPage = 1, limit = 200 } = {}) => fake.segmentsOf(extractionId)
      .filter((s) => s.end_page >= fromPage)
      .slice(0, limit)),

    enqueueJobs: jest.fn(async (rows) => {
      const inserted = [];
      for (const row of rows) {
        if (state.jobs.some((j) => j.idempotency_key === row.idempotency_key)) continue;
        const job = { id: nextId('job'), status: 'queued', attempts: 0, max_attempts: 5, payload: {}, ...row };
        state.jobs.push(job);
        inserted.push({ id: job.id, idempotency_key: job.idempotency_key });
      }
      return inserted;
    }),
    getExtractionJobs: jest.fn(async (extractionId) => state.jobs.filter((j) => j.extraction_id === extractionId).map((j) => ({ ...j }))),

    recordProcessingCost: jest.fn(async (userId, cost) => {
      state.costs.push({ user_id: userId, ...cost });
      return cost;
    }),
    uploadFile: jest.fn(async (bucket, path, buffer) => {
      state.files.set(path, buffer);
      return { path };
    }),
    createSignedUrl: jest.fn(async (bucket, path) => `https://signed.test/${path}`),
    removeFiles: jest.fn(async (bucket, paths) => paths.forEach((p) => state.files.delete(p))),
  };

  fake.reset();
  return fake;
}

module.exports = createFakeSupabase;
