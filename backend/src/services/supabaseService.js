const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');
const PageStore = require('./supabase/pageStore');
const ExtractionStore = require('./supabase/extractionStore');
const ListeningStore = require('./supabase/listeningStore');
const ActivityStore = require('./supabase/activityStore');

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
          mode: bookData.mode || 'read',
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
            mode,
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
}

// Each store is one group of queries; its methods run on this instance (this.supabase, this.adminClient)
for (const Store of [PageStore, ExtractionStore, ListeningStore, ActivityStore]) {
  for (const name of Object.getOwnPropertyNames(Store.prototype)) {
    if (name !== 'constructor') Object.defineProperty(SupabaseService.prototype, name, Object.getOwnPropertyDescriptor(Store.prototype, name));
  }
}

// Create singleton instance
const supabaseService = new SupabaseService();

module.exports = supabaseService;
