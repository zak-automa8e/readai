/** Audio pipeline: extractions, pages, segments and the job queue (spec §3, §5). Mixed into SupabaseService (../supabaseService.js); methods run on that instance. */
class ExtractionStore {
  // ---- Audio pipeline: extractions, pages, segments, job queue (spec §3, §5) ----

  // PostgREST returns at most 1 000 rows per request; read every page of a query
  async selectAll(buildQuery, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await buildQuery().range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  }

  async getUserBook(userId, bookId) {
    const { data, error } = await this.adminClient
      .from('user_books')
      .select('last_read_page, read_front_matter, mode')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // null = follow the book's mode
  async setUserBookMode(userId, bookId, mode) {
    const { error } = await this.adminClient
      .from('user_books')
      .update({ mode })
      .eq('user_id', userId)
      .eq('book_id', bookId);
    if (error) throw error;
  }

  // The live (not failed) extraction of a PDF content for one recipe
  async getLiveExtraction(contentSha256, promptVersion, model) {
    const { data, error } = await this.adminClient
      .from('book_extractions')
      .select('*')
      .eq('content_sha256', contentSha256)
      .eq('prompt_version', promptVersion)
      .eq('model', model)
      .neq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data[0] || null;
  }

  async getExtractionById(extractionId) {
    const { data, error } = await this.adminClient
      .from('book_extractions')
      .select('*')
      .eq('id', extractionId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Throws the Postgres error as is: code 23505 means a live extraction for the recipe already exists
  async createExtraction(row) {
    const { data, error } = await this.adminClient.from('book_extractions').insert(row).select().single();
    if (error) throw error;
    return data;
  }

  /**
   * Update an extraction. With `expectFinalizedThrough` the update only applies while
   * finalized_through_page still holds that value (compare-and-set); null means it did not apply.
   */
  async updateExtraction(extractionId, updates, { expectFinalizedThrough } = {}) {
    let query = this.adminClient.from('book_extractions').update(updates).eq('id', extractionId);
    if (expectFinalizedThrough !== undefined) query = query.eq('finalized_through_page', expectFinalizedThrough);
    const { data, error } = await query.select();
    if (error) throw error;
    return data[0] || null;
  }

  /**
   * page_number → page id for a book. If legacy code created duplicate rows for one page, the
   * oldest wins, every time.
   */
  async getPageIdMap(bookId, fromPage, toPage) {
    const rows = await this.selectAll(() => this.adminClient
      .from('pages')
      .select('id, page_number, created_at')
      .eq('book_id', bookId)
      .gte('page_number', fromPage)
      .lte('page_number', toPage)
      .order('page_number', { ascending: true })
      .order('created_at', { ascending: true }));
    const map = new Map();
    for (const row of rows) if (!map.has(row.page_number)) map.set(row.page_number, row.id);
    return map;
  }

  // Create the missing pages rows 1..totalPages (existing rows are kept, never duplicated)
  async insertPagesBulk(bookId, totalPages) {
    const existing = await this.getPageIdMap(bookId, 1, totalPages);
    const missing = [];
    for (let n = 1; n <= totalPages; n++) {
      if (!existing.has(n)) missing.push({ book_id: bookId, page_number: n, image_url: 'placeholder' });
    }
    for (let i = 0; i < missing.length; i += 500) {
      const { error } = await this.adminClient.from('pages').insert(missing.slice(i, i + 500));
      if (error) throw error;
    }
    return missing.length;
  }

  async getPageTextsByPageIds(pageIds) {
    const rows = [];
    for (let i = 0; i < pageIds.length; i += 100) {
      const { data, error } = await this.adminClient
        .from('page_text')
        .select('id, page_id, extraction_id, prompt_version, model, image_sha256, page_type')
        .in('page_id', pageIds.slice(i, i + 100));
      if (error) throw error;
      rows.push(...data);
    }
    return rows;
  }

  async upsertPageTextBlocks(pageId, fields) {
    const { data, error } = await this.adminClient
      .from('page_text')
      .upsert({ page_id: pageId, ...fields, processed_at: new Date().toISOString() }, { onConflict: 'page_id' })
      .select('id, page_id')
      .single();
    if (error) throw error;
    return data;
  }

  async attachPageTextToExtraction(pageId, extractionId) {
    const { error } = await this.adminClient
      .from('page_text')
      .update({ extraction_id: extractionId })
      .eq('page_id', pageId);
    if (error) throw error;
  }

  // Page numbers (ascending) above `afterPage` that have text from this extraction
  async getDonePageNumbers(extractionId, afterPage = 0) {
    const rows = await this.selectAll(() => this.adminClient
      .from('page_text')
      .select('id, pages!inner(page_number)')
      .eq('extraction_id', extractionId)
      .gt('pages.page_number', afterPage)
      .order('id', { ascending: true }));
    return rows.map((row) => row.pages.page_number).sort((a, b) => a - b);
  }

  async countDonePages(extractionId) {
    const { count, error } = await this.adminClient
      .from('page_text')
      .select('id', { count: 'exact', head: true })
      .eq('extraction_id', extractionId);
    if (error) throw error;
    return count || 0;
  }

  // [{page, blocks, pageType}] ascending, for pages fromPage..toPage of this extraction
  async getPageBlocksRange(extractionId, fromPage, toPage) {
    const rows = await this.selectAll(() => this.adminClient
      .from('page_text')
      .select('id, blocks, page_type, pages!inner(page_number)')
      .eq('extraction_id', extractionId)
      .gte('pages.page_number', fromPage)
      .lte('pages.page_number', toPage)
      .order('id', { ascending: true }));
    return rows
      .map((row) => ({ page: row.pages.page_number, blocks: row.blocks || [], pageType: row.page_type || null }))
      .sort((a, b) => a.page - b.page);
  }

  // Spoken characters of up to `limit` pages already extracted (for the length guard)
  async getSpokenCharSample(extractionId, limit = 50) {
    const { data, error } = await this.adminClient
      .from('page_text')
      .select('validation')
      .eq('extraction_id', extractionId)
      .not('validation', 'is', null)
      .limit(limit);
    if (error) throw error;
    return data.map((row) => row.validation?.spokenChars).filter((n) => typeof n === 'number');
  }

  async getLastSegment(extractionId) {
    const { data, error } = await this.adminClient
      .from('segments')
      .select('*')
      .eq('extraction_id', extractionId)
      .order('seq', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data[0] || null;
  }

  /**
   * Write segments in ONE statement: the rewritten open segment (same seq) and the appended ones
   * land together or not at all.
   */
  async upsertSegments(rows) {
    if (!rows.length) return;
    const { error } = await this.adminClient.from('segments').upsert(rows, { onConflict: 'extraction_id,seq' });
    if (error) throw error;
  }

  // Every segment's text hash in seq order (a rebuild compares against them)
  async getSegmentHashes(extractionId) {
    return this.selectAll(() => this.adminClient
      .from('segments')
      .select('seq, end_page, text_sha256')
      .eq('extraction_id', extractionId)
      .order('seq', { ascending: true }));
  }

  // Drop the segments past `seq` (a rebuild that produced fewer segments)
  async deleteSegmentsAfter(extractionId, seq) {
    const { error } = await this.adminClient.from('segments').delete().eq('extraction_id', extractionId).gt('seq', seq);
    if (error) throw error;
  }

  async getSegments(extractionId, { fromPage = 1, limit = 200 } = {}) {
    const { data, error } = await this.adminClient
      .from('segments')
      .select('id, seq, role, start_page, end_page, parts, text, char_count, sentence_offsets, footnote_markers, status')
      .eq('extraction_id', extractionId)
      .gte('end_page', fromPage)
      .order('seq', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  // Every segment's length in seq order: where each sits in the whole book (the player's book-wide bar)
  async getSegmentCharCounts(extractionId) {
    return this.selectAll(() => this.adminClient
      .from('segments')
      .select('seq, char_count, end_page')
      .eq('extraction_id', extractionId)
      .order('seq', { ascending: true }));
  }

  // Insert jobs; a row whose idempotency_key exists already is skipped. Returns the inserted rows.
  async enqueueJobs(rows) {
    if (!rows.length) return [];
    const { data, error } = await this.adminClient
      .from('book_processing_jobs')
      .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('id, idempotency_key');
    if (error) throw error;
    return data || [];
  }

  async claimJobs(workerId, kinds, count) {
    const { data, error } = await this.adminClient.rpc('claim_jobs', { p_worker: workerId, p_kinds: kinds, p_n: count });
    if (error) throw error;
    return data || [];
  }

  // Update a job this worker holds; false when the lease was lost (another worker re-claimed it)
  async updateClaimedJob(jobId, workerId, updates) {
    const { data, error } = await this.adminClient
      .from('book_processing_jobs')
      .update(updates)
      .eq('id', jobId)
      .eq('locked_by', workerId)
      .eq('status', 'running')
      .select('id');
    if (error) throw error;
    return data.length > 0;
  }

  // The extract_pages jobs of an extraction (audio and follow-up jobs carry its id too, but never gate it)
  async getExtractionJobs(extractionId) {
    return this.selectAll(() => this.adminClient
      .from('book_processing_jobs')
      .select('id, idempotency_key, status, payload, attempts, last_error')
      .eq('extraction_id', extractionId)
      .eq('kind', 'extract_pages')
      .order('created_at', { ascending: true }));
  }
}

module.exports = ExtractionStore;
