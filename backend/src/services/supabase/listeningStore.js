/** Audio pipeline: segment audio, the listening window, plans and daily usage (spec §3, §5.3, O12). Mixed into SupabaseService (../supabaseService.js); methods run on that instance. */
class ListeningStore {
  // ---- Audio pipeline: segment audio, listening window, plans and daily usage (spec §3, §5.3, O12) ----

  // Segments of one extraction by id, in seq order (ids from another extraction are left out)
  async getSegmentsByIds(extractionId, segmentIds) {
    if (!segmentIds.length) return [];
    const { data, error } = await this.adminClient
      .from('segments')
      .select('id, seq, text_sha256')
      .eq('extraction_id', extractionId)
      .in('id', segmentIds)
      .order('seq', { ascending: true });
    if (error) throw error;
    return data;
  }

  async getSegmentById(segmentId) {
    const { data, error } = await this.adminClient
      .from('segments')
      .select('*')
      .eq('id', segmentId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Segments with seq >= fromSeq, in seq order
  async getSegmentsFromSeq(extractionId, fromSeq, limit = 100) {
    const { data, error } = await this.adminClient
      .from('segments')
      .select('id, seq, role, start_page, end_page, parts, text_sha256, char_count, status')
      .eq('extraction_id', extractionId)
      .gte('seq', fromSeq)
      .order('seq', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  // page_number → page_type for every page this extraction has text for
  async getPageTypes(extractionId) {
    const rows = await this.selectAll(() => this.adminClient
      .from('page_text')
      .select('id, page_type, pages!inner(page_number)')
      .eq('extraction_id', extractionId)
      .order('id', { ascending: true }));
    return new Map(rows.map((row) => [row.pages.page_number, row.page_type || null]));
  }

  // page_number → skip for one listener and book (O8)
  async getPageSkipOverrides(userId, bookId) {
    const { data, error } = await this.adminClient
      .from('page_skip_overrides')
      .select('page_number, skip')
      .eq('user_id', userId)
      .eq('book_id', bookId);
    if (error) throw error;
    return new Map(data.map((row) => [row.page_number, row.skip]));
  }

  /**
   * A book with this PDF content that the user owns or has in their library (own books first),
   * or null.
   */
  async findAccessibleBookByContent(userId, contentSha256) {
    const { data: own, error: ownError } = await this.adminClient
      .from('books')
      .select('*')
      .eq('content_sha256', contentSha256)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (ownError) throw ownError;
    if (own.length) return own[0];

    const { data: refs, error } = await this.adminClient
      .from('user_books')
      .select('book_id, books!inner(content_sha256)')
      .eq('user_id', userId)
      .eq('books.content_sha256', contentSha256)
      .limit(1);
    if (error) throw error;
    return refs.length ? this.getBookById(refs[0].book_id) : null;
  }

  async getSegmentAudioRows(voiceSnapshotSha256, textSha256s) {
    const rows = [];
    const unique = [...new Set(textSha256s)];
    for (let i = 0; i < unique.length; i += 50) {
      const { data, error } = await this.adminClient
        .from('segment_audio')
        .select('*')
        .eq('voice_snapshot_sha256', voiceSnapshotSha256)
        .in('text_sha256', unique.slice(i, i + 50));
      if (error) throw error;
      rows.push(...data);
    }
    return rows;
  }

  async getSegmentAudio(textSha256, voiceSnapshotSha256) {
    const { data, error } = await this.adminClient
      .from('segment_audio')
      .select('*')
      .eq('text_sha256', textSha256)
      .eq('voice_snapshot_sha256', voiceSnapshotSha256)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Insert pending clip rows; a row whose (text, voice) exists already is left as it is
  async insertSegmentAudioPending(rows) {
    if (!rows.length) return;
    const { error } = await this.adminClient
      .from('segment_audio')
      .upsert(rows.map((row) => ({ ...row, status: 'pending' })), {
        onConflict: 'text_sha256,voice_snapshot_sha256',
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  /**
   * Update one clip row. `onlyStatus` applies the update only while the row has that status,
   * `unlessStatus` only while it does not. Returns the updated row, or null when nothing matched.
   */
  async updateSegmentAudio(textSha256, voiceSnapshotSha256, updates, { onlyStatus, unlessStatus } = {}) {
    let query = this.adminClient
      .from('segment_audio')
      .update(updates)
      .eq('text_sha256', textSha256)
      .eq('voice_snapshot_sha256', voiceSnapshotSha256);
    if (onlyStatus) query = query.eq('status', onlyStatus);
    if (unlessStatus) query = query.neq('status', unlessStatus);
    const { data, error } = await query.select();
    if (error) throw error;
    return data[0] || null;
  }

  async getJobsByKeys(keys) {
    const rows = [];
    // Keys are ~140 chars: small batches keep the request URL short
    for (let i = 0; i < keys.length; i += 25) {
      const { data, error } = await this.adminClient
        .from('book_processing_jobs')
        .select('id, idempotency_key, status')
        .in('idempotency_key', keys.slice(i, i + 25));
      if (error) throw error;
      rows.push(...data);
    }
    return rows;
  }

  // Jobs whose idempotency key starts with `prefix` (hex, '-', ':' and letters only: no LIKE wildcards)
  async getJobsByKeyPrefix(prefix) {
    return this.selectAll(() => this.adminClient
      .from('book_processing_jobs')
      .select('id, idempotency_key, status')
      .like('idempotency_key', `${prefix}%`)
      .order('created_at', { ascending: true }));
  }

  // Make the queued jobs of one kind for an extraction claimable now; returns how many
  async wakeQueuedJobs(extractionId, kind) {
    const { data, error } = await this.adminClient
      .from('book_processing_jobs')
      .update({ run_after: new Date().toISOString() })
      .eq('extraction_id', extractionId)
      .eq('kind', kind)
      .eq('status', 'queued')
      .select('id');
    if (error) throw error;
    return data.length;
  }

  // The user's subscription row with its plan, or null
  async getSubscription(userId) {
    const { data, error } = await this.adminClient
      .from('subscriptions')
      .select('plan_id, status, ends_at, plans(id, name, daily_page_limit)')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getPlan(planId) {
    const { data, error } = await this.adminClient
      .from('plans')
      .select('id, name, daily_page_limit')
      .eq('id', planId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // Plans on offer, cheapest first (Settings lists them)
  async listPlans() {
    const { data, error } = await this.adminClient
      .from('plans')
      .select('id, name, daily_page_limit, price_cents, currency')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data;
  }

  // Pages counted toward the user's limit on one UTC day (every book)
  async getDailyPageUsage(userId, usageDate) {
    return this.selectAll(() => this.adminClient
      .from('daily_page_usage')
      .select('book_id, page_number')
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
      .order('first_listened_at', { ascending: true }));
  }

  /**
   * Count a page toward today's limit (RPC record_page_listen). A page already counted today is
   * allowed without counting again.
   * @returns {Promise<{allowed: boolean, counted: boolean, used: number, limit: number, plan: string}>}
   */
  async recordPageListen(userId, bookId, pageNumber) {
    const { data, error } = await this.adminClient.rpc('record_page_listen', {
      p_user: userId,
      p_book: bookId,
      p_page: pageNumber,
    });
    if (error) throw error;
    return data;
  }
}

module.exports = ListeningStore;
