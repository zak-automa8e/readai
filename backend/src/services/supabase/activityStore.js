const logger = require('../../utils/logger');

/** Processing costs, reading sessions and chat conversations. Mixed into SupabaseService (../supabaseService.js); methods run on that instance. */
class ActivityStore {
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

module.exports = ActivityStore;
