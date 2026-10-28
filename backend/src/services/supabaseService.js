const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');

class SupabaseService {
  async getBookById(bookId) {
    try {
      const { data, error } = await this.adminClient
        .from('books')
        .select('*')
        .eq('id', bookId)
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching book by id:', error);
      throw error;
    }
  }

  async countUserBookRefs(bookId) {
    try {
      const { count, error } = await this.adminClient
        .from('user_books')
        .select('id', { count: 'exact', head: true })
        .eq('book_id', bookId);
      if (error) throw error;
      return count || 0;
    } catch (error) {
      logger.error('Error counting user_books refs:', error);
      throw error;
    }
  }

  async deleteBook(bookId) {
    try {
      const { data, error } = await this.adminClient
        .from('books')
        .delete()
        .eq('id', bookId)
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error deleting book:', error);
      throw error;
    }
  }
  constructor() {
    this.initialized = false;

    if (!config.supabase.url || !config.supabase.serviceKey) {
      logger.warn('Supabase configuration is missing. Backend will start but database features will be unavailable.');
      this.supabase = null;
      this.adminClient = null;
      return;
    }

    // Create Supabase client with service key for backend operations
    this.supabase = createClient(
      config.supabase.url,
      config.supabase.serviceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Create admin client that bypasses RLS
    this.adminClient = createClient(
      config.supabase.url,
      config.supabase.serviceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        db: {
          schema: 'public'
        }
      }
    );

    this.initialized = true;
    logger.info('Supabase service initialized successfully');
  }

  checkInitialized() {
    if (!this.initialized) {
      throw new Error('Supabase is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.');
    }
  }

  // User management
  async createUserProfile(userId, userData = {}) {
    try {
      const { data, error } = await this.supabase
        .from('user_profiles')
        .insert({
          id: userId,
          display_name: userData.display_name || userData.email,
          ...userData
        });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error creating user profile:', error);
      throw error;
    }
  }

  async getUserProfile(userId) {
    try {
      const { data, error } = await this.supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      return data;
    } catch (error) {
      logger.error('Error fetching user profile:', error);
      throw error;
    }
  }

  // Book management
  async createBook(userId, bookData) {
    try {
      // Use admin client to bypass RLS for service operations
      const { data, error } = await this.adminClient
        .from('books')
        .insert({
          user_id: userId,
          title: bookData.title,
          author: bookData.author,
          description: bookData.description,
          pdf_url: bookData.pdf_url,
          pdf_source: bookData.pdf_source || 'upload',
          thumbnail_url: bookData.thumbnail_url,
          total_pages: bookData.total_pages,
          processing_status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error creating book:', error);
      throw error;
    }
  }

  async getUserBooks(userId) {
    try {
      const { data, error } = await this.supabase
        .from('user_books')
        .select(`
          *,
          books (
            id,
            title,
            author,
            description,
            pdf_url,
            pdf_source,
            thumbnail_url,
            total_pages,
            processing_status,
            created_at,
            updated_at
          )
        `)
        .eq('user_id', userId)
        .order('last_read_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching user books:', error);
      throw error;
    }
  }

  async updateBook(bookId, updates) {
    try {
      const { data, error } = await this.adminClient
        .from('books')
        .update(updates)
        .eq('id', bookId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error updating book:', error);
      throw error;
    }
  }

  async addBookToLibrary(userId, bookId, personalData = {}) {
    try {
      const { data, error } = await this.adminClient
        .from('user_books')
        .insert({
          user_id: userId,
          book_id: bookId,
          personal_title: personalData.personal_title,
          tags: personalData.tags || [],
          is_favorite: personalData.is_favorite || false
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error adding book to library:', error);
      throw error;
    }
  }

  async updateBookProgress(userId, bookId, progressData) {
    try {
      const { data, error } = await this.supabase
        .from('user_books')
        .update({
          last_read_page: progressData.last_read_page,
          reading_progress: progressData.reading_progress,
          total_reading_time_minutes: progressData.total_reading_time_minutes,
          last_read_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error updating book progress:', error);
      throw error;
    }
  }

  async ensureUserHasBookAccess(userId, bookId) {
    try {
      const { data: ownership, error: ownershipError } = await this.adminClient
        .from('books')
        .select('user_id')
        .eq('id', bookId)
        .single();

      if (ownershipError && ownershipError.code !== 'PGRST116') {
        throw ownershipError;
      }

      if (ownership && ownership.user_id === userId) {
        return true;
      }

      const { count, error } = await this.adminClient
        .from('user_books')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('book_id', bookId);

      if (error) throw error;

      return (count || 0) > 0;
    } catch (error) {
      logger.error('Error verifying book access:', error);
      throw error;
    }
  }

  async getBookNotes(userId, bookId) {
    try {
      const { data, error } = await this.adminClient
        .from('book_notes')
        .select('*')
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Error fetching book notes:', error);
      throw error;
    }
  }

  async createBookNote(userId, bookId, noteData) {
    try {
      const { data, error } = await this.adminClient
        .from('book_notes')
        .insert({
          user_id: userId,
          book_id: bookId,
          page_id: noteData.page_id || null,
          title: noteData.title || null,
          content: noteData.content,
          page_number: noteData.page_number || null,
          text_selection: noteData.text_selection || null,
          note_type: noteData.note_type || 'general',
          position_metadata: noteData.position_metadata || {},
          is_private: typeof noteData.is_private === 'boolean' ? noteData.is_private : true
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error creating book note:', error);
      throw error;
    }
  }

  async getBookNoteById(noteId) {
    try {
      const { data, error } = await this.adminClient
        .from('book_notes')
        .select('*')
        .eq('id', noteId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } catch (error) {
      logger.error('Error fetching book note by id:', error);
      throw error;
    }
  }

  async updateBookNote(userId, noteId, updates) {
    try {
      const existing = await this.getBookNoteById(noteId);
      if (!existing) {
        return null;
      }

      if (existing.user_id !== userId) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }

      const updatePayload = { ...updates, updated_at: new Date().toISOString() };

      const { data, error } = await this.adminClient
        .from('book_notes')
        .update(updatePayload)
        .eq('id', noteId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      if (error.status === 403) throw error;
      logger.error('Error updating book note:', error);
      throw error;
    }
  }

  async deleteBookNote(userId, noteId) {
    try {
      const existing = await this.getBookNoteById(noteId);
      if (!existing) {
        return false;
      }

      if (existing.user_id !== userId) {
        const err = new Error('Forbidden');
        err.status = 403;
        throw err;
      }

      const { error } = await this.adminClient
        .from('book_notes')
        .delete()
        .eq('id', noteId);

      if (error) throw error;
      return true;
    } catch (error) {
      if (error.status === 403) throw error;
      logger.error('Error deleting book note:', error);
      throw error;
    }
  }

  // Page management
  async createPage(bookId, pageData) {
    try {
      const { data, error } = await this.supabase
        .from('pages')
        .insert({
          book_id: bookId,
          page_number: pageData.page_number,
          image_url: pageData.image_url || 'placeholder',
          image_width: pageData.image_width,
          image_height: pageData.image_height
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error creating page:', error);
      throw error;
    }
  }

  async getPageByBookAndNumber(bookId, pageNumber) {
    try {
      const { data, error } = await this.supabase
        .from('pages')
        .select('*')
        .eq('book_id', bookId)
        .eq('page_number', pageNumber)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      return data;
    } catch (error) {
      logger.error('Error fetching page:', error);
      throw error;
    }
  }

  async getOrCreatePage(bookId, pageNumber, imageUrl = null) {
    try {
      let page = await this.getPageByBookAndNumber(bookId, pageNumber);

      if (!page) {
        page = await this.createPage(bookId, {
          page_number: pageNumber,
          image_url: imageUrl
        });
      }

      return page;
    } catch (error) {
      logger.error('Error getting or creating page:', error);
      throw error;
    }
  }

  async getPageText(pageId) {
    try {
      const { data, error } = await this.supabase
        .from('page_text')
        .select('*')
        .eq('page_id', pageId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page text:', error);
      throw error;
    }
  }

  async getPageTextByBookAndNumber(bookId, pageNumber) {
    try {
      const { data, error } = await this.supabase
        .from('page_text')
        .select(`
          *,
          pages!inner (
            book_id,
            page_number
          )
        `)
        .eq('pages.book_id', bookId)
        .eq('pages.page_number', pageNumber)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page text by book and number:', error);
      throw error;
    }
  }

  async getPageAudio(pageId, voicePersona = 'Zephyr') {
    try {
      const { data, error } = await this.supabase
        .from('page_audio')
        .select('*')
        .eq('page_id', pageId)
        .eq('voice_persona', voicePersona)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page audio:', error);
      throw error;
    }
  }

  async getPageAudioByBookAndNumber(bookId, pageNumber, voicePersona = 'Zephyr') {
    try {
      const { data, error } = await this.supabase
        .from('page_audio')
        .select(`
          *,
          pages!inner (
            book_id,
            page_number
          )
        `)
        .eq('pages.book_id', bookId)
        .eq('pages.page_number', pageNumber)
        .eq('voice_persona', voicePersona)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page audio by book and number:', error);
      throw error;
    }
  }

  async savePageText(pageId, textData) {
    try {
      const { data, error } = await this.supabase
        .from('page_text')
        .upsert({
          page_id: pageId,
          extracted_text: textData.extracted_text,
          extraction_confidence: textData.extraction_confidence,
          extraction_metadata: textData.extraction_metadata || {},
          processing_duration_ms: textData.processing_duration_ms,
          processed_at: new Date().toISOString()
        }, { onConflict: 'page_id' })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error saving page text:', error);
      throw error;
    }
  }

  async savePageAudio(pageId, audioData) {
    try {
      const { data, error } = await this.supabase
        .from('page_audio')
        .upsert({
          page_id: pageId,
          voice_persona: audioData.voice_persona || 'default',
          audio_url: audioData.audio_url,
          audio_duration_seconds: audioData.audio_duration_seconds,
          audio_format: audioData.audio_format || 'wav',
          audio_size_bytes: audioData.audio_size_bytes,
          voice_settings: audioData.voice_settings || {},
          generation_metadata: audioData.generation_metadata || {},
          processing_duration_ms: audioData.processing_duration_ms,
          processed_at: new Date().toISOString()
        }, { onConflict: 'page_id,voice_persona' })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error saving page audio:', error);
      throw error;
    }
  }

  // Page retrieval methods
  async getPageByBookAndNumber(bookId, pageNumber) {
    try {
      const { data, error } = await this.supabase
        .from('pages')
        .select('*')
        .eq('book_id', bookId)
        .eq('page_number', pageNumber)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      return data;
    } catch (error) {
      logger.error('Error fetching page:', error);
      throw error;
    }
  }

  async getOrCreatePage(bookId, pageNumber, imageUrl = null) {
    try {
      let page = await this.getPageByBookAndNumber(bookId, pageNumber);

      if (!page) {
        page = await this.createPage(bookId, {
          page_number: pageNumber,
          image_url: imageUrl
        });
      }

      return page;
    } catch (error) {
      logger.error('Error getting or creating page:', error);
      throw error;
    }
  }

  async getPageText(pageId) {
    try {
      const { data, error } = await this.supabase
        .from('page_text')
        .select('*')
        .eq('page_id', pageId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page text:', error);
      throw error;
    }
  }

  async getPageTextByBookAndNumber(bookId, pageNumber) {
    try {
      const { data, error } = await this.supabase
        .from('page_text')
        .select(`
          *,
          pages!inner (
            book_id,
            page_number
          )
        `)
        .eq('pages.book_id', bookId)
        .eq('pages.page_number', pageNumber)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page text by book and number:', error);
      throw error;
    }
  }

  async getPageAudio(pageId, voicePersona = 'Zephyr') {
    try {
      const { data, error } = await this.supabase
        .from('page_audio')
        .select('*')
        .eq('page_id', pageId)
        .eq('voice_persona', voicePersona)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page audio:', error);
      throw error;
    }
  }

  async getPageAudioByBookAndNumber(bookId, pageNumber, voicePersona = 'Zephyr') {
    try {
      const { data, error } = await this.supabase
        .from('page_audio')
        .select(`
          *,
          pages!inner (
            book_id,
            page_number
          )
        `)
        .eq('pages.book_id', bookId)
        .eq('pages.page_number', pageNumber)
        .eq('voice_persona', voicePersona)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching page audio by book and number:', error);
      throw error;
    }
  }

  async saveAudioFile(audioBuffer, filePath) {
    try {
      const { data, error } = await this.uploadFile('readai-media', filePath, audioBuffer, {
        contentType: 'audio/wav',
        upsert: true
      });

      if (error) throw error;
      return this.getFileUrl('readai-media', filePath);
    } catch (error) {
      logger.error('Error saving audio file:', error);
      throw error;
    }
  }

  // File storage operations
  async uploadFile(bucket, filePath, file, options = {}) {
    try {
      const { data, error } = await this.adminClient.storage
        .from(bucket)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: options.upsert || false,
          ...options
        });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error uploading file:', error);
      throw error;
    }
  }

  async saveAudioFile(audioBuffer, filePath) {
    try {
      const { data, error } = await this.uploadFile('readai-media', filePath, audioBuffer, {
        contentType: 'audio/wav',
        upsert: true
      });

      if (error) throw error;
      return this.getFileUrl('readai-media', filePath);
    } catch (error) {
      logger.error('Error saving audio file:', error);
      throw error;
    }
  }

  getFileUrl(bucket, filePath) {
    try {
      logger.info(`Getting URL for bucket: ${bucket}, path: ${filePath}`);

      const result = this.supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      logger.info(`getPublicUrl result:`, result);

      const { data } = result;

      logger.info(`Data from getPublicUrl:`, data);

      if (!data || !data.publicUrl) {
        logger.error(`No public URL in result data:`, { bucket, filePath, data });
        throw new Error('Failed to get public URL from Supabase');
      }

      logger.info(`Generated file URL: ${data.publicUrl}`, { bucket, filePath });
      return data.publicUrl;
    } catch (error) {
      logger.error('Error getting file URL:', error);
      throw error;
    }
  }

  async deleteFile(bucket, filePath) {
    try {
      const { data, error } = await this.adminClient.storage
        .from(bucket)
        .remove([filePath]);

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error deleting file:', error);
      throw error;
    }
  }

  async createSignedUrl(bucket, filePath, expiresInSeconds) {
    const { data, error } = await this.adminClient.storage.from(bucket).createSignedUrl(filePath, expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  }

  async removeFiles(bucket, filePaths) {
    if (!filePaths.length) return;
    const { error } = await this.adminClient.storage.from(bucket).remove(filePaths);
    if (error) throw error;
  }

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
      .select('last_read_page, read_front_matter')
      .eq('user_id', userId)
      .eq('book_id', bookId)
      .maybeSingle();
    if (error) throw error;
    return data;
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

  // Cost tracking
  async recordProcessingCost(userId, costData) {
    try {
      const { data, error } = await this.supabase
        .from('processing_costs')
        .insert({
          user_id: userId,
          book_id: costData.book_id,
          page_id: costData.page_id,
          text_extraction_cost: costData.text_extraction_cost || 0,
          text_to_speech_cost: costData.text_to_speech_cost || 0,
          conversation_cost: costData.conversation_cost || 0,
          tokens_used_text: costData.tokens_used_text || 0,
          tokens_used_audio: costData.tokens_used_audio || 0,
          tokens_used_conversation: costData.tokens_used_conversation || 0,
          cost_breakdown: costData.cost_breakdown || {}
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error recording processing cost:', error);
      throw error;
    }
  }

  // Reading sessions
  async startReadingSession(userId, sessionData) {
    try {
      const { data, error } = await this.supabase
        .from('reading_sessions')
        .insert({
          user_id: userId,
          book_id: sessionData.book_id,
          start_page: sessionData.start_page,
          end_page: sessionData.start_page, // Will be updated when session ends
          pages_read: 0,
          voice_persona: sessionData.voice_persona,
          playback_speed: sessionData.playback_speed || 1.0,
          started_at: new Date().toISOString(),
          session_status: 'active'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error starting reading session:', error);
      throw error;
    }
  }

  async endReadingSession(sessionId, sessionData) {
    try {
      const { data, error } = await this.supabase
        .from('reading_sessions')
        .update({
          end_page: sessionData.end_page,
          pages_read: sessionData.pages_read,
          listening_time_minutes: sessionData.listening_time_minutes,
          ended_at: new Date().toISOString(),
          session_status: 'completed'
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error ending reading session:', error);
      throw error;
    }
  }

  // AI Conversation methods
  async createConversation(conversationData) {
    try {
      const { data, error } = await this.supabase
        .from('ai_conversations')
        .insert({
          user_id: conversationData.userId,
          book_id: conversationData.bookId,
          title: conversationData.title,
          conversation_type: conversationData.conversationType || 'general'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error creating conversation:', error);
      throw error;
    }
  }

  async getConversationById(conversationId) {
    try {
      const { data, error } = await this.supabase
        .from('ai_conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching conversation by id:', error);
      throw error;
    }
  }

  async getConversationByBookId(userId, bookId) {
    try {
      const { data, error } = await this.supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', userId)
        .eq('book_id', bookId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }
      return data;
    } catch (error) {
      logger.error('Error fetching conversation by book id:', error);
      throw error;
    }
  }

  async updateConversation(conversationId, updates) {
    try {
      const { data, error } = await this.supabase
        .from('ai_conversations')
        .update(updates)
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error updating conversation:', error);
      throw error;
    }
  }

  async createMessage(messageData) {
    try {
      const { data, error } = await this.supabase
        .from('ai_messages')
        .insert({
          conversation_id: messageData.conversationId,
          role: messageData.role,
          content: messageData.content,
          tokens_used: messageData.tokensUsed || 0,
          cost: messageData.cost || 0,
          message_metadata: messageData.messageMetadata || {}
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error creating message:', error);
      throw error;
    }
  }

  async getConversationMessages(conversationId) {
    try {
      const { data, error } = await this.supabase
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching conversation messages:', error);
      throw error;
    }
  }

  async deleteConversationMessages(conversationId) {
    try {
      const { error } = await this.supabase
        .from('ai_messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (error) throw error;
      return true;
    } catch (error) {
      logger.error('Error deleting conversation messages:', error);
      throw error;
    }
  }

  async getUserConversations(userId) {
    try {
      const { data, error } = await this.supabase
        .from('ai_conversations')
        .select(`
          *,
          books (
            id,
            title,
            author,
            thumbnail_url
          )
        `)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error fetching user conversations:', error);
      throw error;
    }
  }
}

// Create singleton instance
const supabaseService = new SupabaseService();

module.exports = supabaseService;
