/**
 * API service for interacting with the backend
 */

// Base API URL - can be configured based on environment
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface ChatConversationResponseMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface ChatConversationResponse {
  success: boolean;
  conversation: {
    id: string;
    hasActiveCache: boolean;
    cacheExpiresAt: string | null;
    messages: ChatConversationResponseMessage[];
  };
}

export interface UploadBookToGeminiResponse {
  success: boolean;
  conversationId: string;
  cacheId: string;
  expiresAt: string | null;
  message: string;
}

export interface SendChatMessageResponse {
  success: boolean;
  message: string;
  messageId: string;
  tokensUsed: {
    cached: number;
    prompt: number;
    candidates: number;
    total: number;
  };
}

export interface ExtendCacheResponse {
  success: boolean;
  expiresAt?: string;
  message?: string;
}

/**
 * Get authentication headers from localStorage
 */
const getAuthHeaders = () => {
  const session = localStorage.getItem('readai_session');
  if (session) {
    try {
      const parsedSession = JSON.parse(session);
      
      if (parsedSession.access_token && parsedSession.expires_at > Date.now() / 1000) {
        return {
          'Authorization': `Bearer ${parsedSession.access_token}`
        };
      } else {
        // Session invalid or expired
      }
    } catch (error) {
      // Ignore parse errors
    }
  } else {
    // No session found
  }
  return {};
};

/**
 * Service for interacting with the ReadAI backend
 */
const apiService = {
  /**
   * Update book details (title, author, description, cover)
   * @param {string} bookId
   * @param {Object} updates - { title?, author?, description?, coverFile? }
   * @returns {Promise<Object>} - Updated book
   */
  async updateBook(bookId: string, updates: { title?: string; author?: string; description?: string; coverFile?: File }) {
    try {
      const formData = new FormData();
      if ('title' in updates && updates.title !== undefined) formData.append('title', updates.title);
      if ('author' in updates && updates.author !== undefined) formData.append('author', updates.author);
      if ('description' in updates && updates.description !== undefined) formData.append('description', updates.description);
      if (updates.coverFile) formData.append('cover', updates.coverFile);

      const response = await fetch(`${API_BASE_URL}/books/${bookId}`, {
        method: 'PATCH',
        mode: 'cors',
        headers: {
          ...getAuthHeaders()
          // Do not set Content-Type for FormData
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update book');
      }
      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Delete book or remove from user's library
   * @param {string} bookId
   * @returns {Promise<Object>} - { success, removedFromLibrary, fullyDeleted }
   */
  async deleteBook(bookId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/books/${bookId}`, {
        method: 'DELETE',
        mode: 'cors',
        headers: {
          ...getAuthHeaders()
        }
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete book');
      }
      return await response.json();
    } catch (error) {
      throw error;
    }
  },
  /**
   * Convert an image to text using AI
   * @param {string} imageBase64 - Base64 encoded image data
   * @returns {Promise<Object>} - Extracted text in JSON format
   */
  async imageToText(imageBase64) {
    try {
      const response = await fetch(`${API_BASE_URL}/image-to-text`, {
        method: 'POST',
        mode: 'cors',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ image: imageBase64 }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to extract text from image");
      }

      return await response.json();
    } catch (error) {
  // Surface error to caller
      throw error;
    }
  },

  /**
   * Convert text to audio using AI
   * @param {string} text - Text to convert to audio
   * @returns {Promise<Blob>} - Audio blob
   */
  async textToAudio(text) {
    try {
      const response = await fetch(`${API_BASE_URL}/text-to-audio`, {
        method: 'POST',
        mode: 'cors',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'audio/wav',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ text }),
      });

      if (response.status === 429) {
        throw new Error("RATE_LIMIT_EXCEEDED");
      }

      if (!response.ok) {
        throw new Error(`Failed to generate audio: ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
  // Surface error to caller
      throw error;
    }
  },

  /**
   * Proxy a PDF from an external URL
   * @param {string} url - URL of the PDF to proxy
   * @returns {Promise<Blob>} - PDF blob
   */
  async proxyPdf(url) {
    try {
      const response = await fetch(`${API_BASE_URL}/pdf-proxy?url=${encodeURIComponent(url)}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/pdf',
          ...getAuthHeaders()
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to proxy PDF");
      }

      return await response.blob();
    } catch (error) {
  // Surface error to caller
      throw error;
    }
  },

  /**
   * Get user's book library from backend
   * @returns {Promise<Object>} - User's books
   */
  async getUserLibrary() {
    try {
      const response = await fetch(`${API_BASE_URL}/books/library`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
          ...getAuthHeaders()
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch library");
      }

      return await response.json();
    } catch (error) {
  // Surface error to caller
      throw error;
    }
  },

  /**
   * Create a new book in user's library
   * @param {Object} bookData - Book information
   * @returns {Promise<Object>} - Created book
   */
  async createBook(bookData: {
    title: string;
    author?: string;
    description?: string;
    pdf_url?: string;
    pdf_source?: string;
    thumbnail_url?: string;
    total_pages?: number;
  }) {
    try {
      const response = await fetch(`${API_BASE_URL}/books`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(bookData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create book");
      }

      return await response.json();
    } catch (error) {
  // Surface error to caller
      throw error;
    }
  },

  /**
   * Upload a PDF file
   * @param {File} file - PDF file to upload
   * @param {Object} metadata - Book metadata
   * @returns {Promise<Object>} - Upload result
   */
  async uploadPDF(file: File, metadata: { title: string; author?: string; description?: string }) {
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('title', metadata.title);
      if (metadata.author) formData.append('author', metadata.author);
      if (metadata.description) formData.append('description', metadata.description);

      const response = await fetch(`${API_BASE_URL}/books/upload`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          ...getAuthHeaders()
          // Don't set Content-Type for FormData, let browser set it with boundary
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload PDF");
      }

      return await response.json();
    } catch (error) {
  // Surface error to caller
      throw error;
    }
  },

  /**
   * Create book from URL
   * @param {Object} bookData - Book data including URL
   * @returns {Promise<Object>} - Created book
   */
  async createBookFromUrl(bookData: {
    title: string;
    author?: string;
    description?: string;
    pdf_url: string;
  }) {
    return this.createBook({
      ...bookData,
      pdf_source: 'url'
    });
  },

  /**
   * Check if the backend is available
   * @returns {Promise<boolean>} - True if backend is available
   */
  async checkHealth() {
    try {
      const baseUrl = API_BASE_URL.replace('/api', '');
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json'
        }
      });
      
  if (!response.ok) return false;
      
      const data = await response.json();
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * Get or create conversation for a book
   */
  async getOrCreateConversation(bookId: string): Promise<ChatConversationResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/conversation/${bookId}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
          ...getAuthHeaders()
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get conversation');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Upload a book to Gemini for chat functionality
   */
  async uploadBookToGemini(data: {
    conversationId: string;
    bookId: string;
    pdfUrl: string;
    title: string;
  }): Promise<UploadBookToGeminiResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/upload-book`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload book to Gemini');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Send a chat message
   */
  async sendChatMessage(data: {
    conversationId: string;
    message: string;
  }): Promise<SendChatMessageResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/message`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send chat message');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Extend cache lifetime
   */
  async extendCacheLifetime(conversationId: string, ttl: string = '3600s'): Promise<ExtendCacheResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/extend-cache`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ conversationId, ttl })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to extend cache lifetime');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Delete cache (cleanup)
   */
  async deleteChatCache(conversationId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/cache/${conversationId}`, {
        method: 'DELETE',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
          ...getAuthHeaders()
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete chat cache');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Get all notes for a book
   */
  async getBookNotes(bookId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/books/${bookId}/notes`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
          ...getAuthHeaders()
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch notes');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Get cached page text or extract text from page
   * @param {string} bookId - Book ID
   * @param {number} pageNumber - Page number
   * @param {string} imageBase64 - Base64 encoded page image
   * @returns {Promise<Object>} - Page text response
   */
  async getCachedPageText(bookId: string, pageNumber: number, imageBase64: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/pages/text`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ 
          bookId, 
          pageNumber, 
          imageData: imageBase64,
          mimeType: imageBase64.startsWith('data:') ? imageBase64.split(';')[0].split(':')[1] : 'image/png'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get page text");
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Get cached page audio or generate audio from page text
   * @param {string} bookId - Book ID
   * @param {number} pageNumber - Page number
   * @param {string} text - Page text to convert to audio
   * @param {string} voicePersona - Voice persona to use (default: 'Sadaltager')
   * @returns {Promise<Object>} - Page audio response
   */
  async getCachedPageAudio(bookId: string, pageNumber: number, text: string, voicePersona: string = 'Sadaltager') {
    try {
      const response = await fetch(`${API_BASE_URL}/pages/audio`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ 
          bookId, 
          pageNumber, 
          text,
          voicePersona
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get page audio");
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Create a new note for a book
   */
  async createBookNote(bookId: string, payload: {
    content: string;
    title?: string;
    pageNumber?: number | null;
    pageId?: string | null;
    textSelection?: string | null;
    noteType?: string;
    positionMetadata?: Record<string, unknown> | string;
    isPrivate?: boolean;
  }) {
    try {
      const response = await fetch(`${API_BASE_URL}/books/${bookId}/notes`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create note');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Update an existing note
   */
  async updateBookNote(bookId: string, noteId: string, payload: {
    content?: string;
    title?: string | null;
    pageNumber?: number | null;
    textSelection?: string | null;
    noteType?: string;
    positionMetadata?: Record<string, unknown> | string;
    isPrivate?: boolean;
  }) {
    try {
      const response = await fetch(`${API_BASE_URL}/books/${bookId}/notes/${noteId}`, {
        method: 'PATCH',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update note');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  },

  /**
   * Delete a note for a book
   */
  async deleteBookNote(bookId: string, noteId: string) {
    try {
      const response = await fetch(`${API_BASE_URL}/books/${bookId}/notes/${noteId}`, {
        method: 'DELETE',
        mode: 'cors',
        headers: {
          'Accept': 'application/json',
          ...getAuthHeaders()
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete note');
      }

      return await response.json();
    } catch (error) {
      throw error;
    }
  }
};

export default apiService;
