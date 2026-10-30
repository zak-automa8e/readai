const logger = require('../../utils/logger');

/** Page rows, page text and page audio (the per-page pipeline), and Storage files. Mixed into SupabaseService (../supabaseService.js); methods run on that instance. */
class PageStore {
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
}

module.exports = PageStore;
