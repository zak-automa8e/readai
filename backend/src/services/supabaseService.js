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
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error('Supabase configuration is missing. Please check your environment variables.');
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

    logger.info('Supabase service initialized successfully');
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
          processing_duration_ms: textData.processing_duration_ms
        })
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
          processing_duration_ms: audioData.processing_duration_ms
        })
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
      const { data, error } = await this.supabase.storage
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
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .remove([filePath]);

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Error deleting file:', error);
      throw error;
    }
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
