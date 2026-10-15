import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import apiService, { type ChatConversationResponseMessage } from "@/services/apiService";
import type { Book } from "@/contexts/BooksContext";

export interface ChatMessage {
  id: string;
  content: string;
  sender: "human" | "assistant";
  timestamp: Date;
}

const CACHE_EXTENSION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

const mapMessages = (items: ChatConversationResponseMessage[] = []): ChatMessage[] =>
  items.map(item => ({
    id: item.id,
    content: item.content,
    sender: item.role === "user" ? "human" : "assistant",
    timestamp: item.created_at ? new Date(item.created_at) : new Date(),
  }));

/**
 * The book's single Gemini conversation: init (get-or-create), one-time upload of the book, cache
 * extension and `send`. Lifted out of ChatWindow so the Chat and Explain tabs share one history and
 * the state survives tab switches and pane collapse.
 */
export const useBookConversation = (book: Book | null) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      content: "Select a book from your library to start a conversation.",
      sender: "assistant",
      timestamp: new Date(),
    },
  ]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isUploadingBook, setIsUploadingBook] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [cacheExpiresAt, setCacheExpiresAt] = useState<Date | null>(null);
  const [hasActiveCache, setHasActiveCache] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const bookRef = useRef(book);
  bookRef.current = book;

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [
      ...prev,
      { id: `system-${Date.now()}`, content, sender: "assistant", timestamp: new Date() },
    ]);
  }, []);

  const uploadBookToGemini = useCallback(
    async (conversationIdParam: string) => {
      const currentBook = bookRef.current;
      if (!currentBook) return;
      if (!currentBook.pdf_url) {
        const description = "This book is missing a PDF URL. Please re-upload the book.";
        setUploadError(description);
        toast({ title: "Upload failed", description, variant: "destructive" });
        return;
      }

      setIsUploadingBook(true);
      setUploadError(null);
      addSystemMessage(`Indexing "${currentBook.title}" so we can chat about it...`);

      try {
        const response = await apiService.uploadBookToGemini({
          conversationId: conversationIdParam,
          bookId: currentBook.id,
          pdfUrl: currentBook.pdf_url,
          title: currentBook.title,
        });

        setCacheExpiresAt(response.expiresAt ? new Date(response.expiresAt) : null);
        setHasActiveCache(true);

        addSystemMessage(`All set! I can now answer questions about "${currentBook.title}".`);
        toast({ title: "Document ready", description: `"${currentBook.title}" is now cached for quick answers.` });
      } catch (error) {
        const description = error instanceof Error ? error.message : "Failed to prepare the document for chat";
        setUploadError(description);
        addSystemMessage(`I couldn't prepare "${currentBook.title}" for chat. Please try again.`);
        toast({ title: "Upload failed", description, variant: "destructive" });
      } finally {
        setIsUploadingBook(false);
      }
    },
    [addSystemMessage]
  );

  const bookId = book?.id;

  // Re-initialise whenever the book changes
  useEffect(() => {
    const currentBook = bookRef.current;
    let cancelled = false;

    setConversationId(null);
    setHasActiveCache(false);
    setCacheExpiresAt(null);
    setUploadError(null);

    if (!currentBook) {
      setMessages([
        {
          id: "no-book",
          content: "Select a book from your library to start a conversation.",
          sender: "assistant",
          timestamp: new Date(),
        },
      ]);
      return;
    }

    const init = async () => {
      setIsInitializing(true);
      setMessages([
        {
          id: `loading-${currentBook.id}`,
          content: `Loading chat session for "${currentBook.title}"...`,
          sender: "assistant",
          timestamp: new Date(),
        },
      ]);

      try {
        const { conversation } = await apiService.getOrCreateConversation(currentBook.id);
        if (cancelled) return;

        setConversationId(conversation.id);
        setHasActiveCache(conversation.hasActiveCache);
        setCacheExpiresAt(conversation.cacheExpiresAt ? new Date(conversation.cacheExpiresAt) : null);

        const existingMessages = mapMessages(conversation.messages);
        setMessages(
          existingMessages.length > 0
            ? existingMessages
            : [
                {
                  id: `welcome-${conversation.id}`,
                  content: `Hi! I'm ready to help with "${currentBook.title}". Ask me anything about this book once I'm done preparing the document context.`,
                  sender: "assistant",
                  timestamp: new Date(),
                },
              ]
        );

        if (!conversation.hasActiveCache) {
          await uploadBookToGemini(conversation.id);
        }
      } catch (error) {
        if (cancelled) return;
        const description = error instanceof Error ? error.message : "Failed to initialize chat";
        setUploadError(description);
        toast({ title: "Chat unavailable", description, variant: "destructive" });
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    };

    init().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, uploadBookToGemini]);

  const checkAndExtendCache = useCallback(async () => {
    if (!conversationId || !cacheExpiresAt) return;
    if (cacheExpiresAt.getTime() - Date.now() > CACHE_EXTENSION_THRESHOLD_MS) return;

    try {
      const response = await apiService.extendCacheLifetime(conversationId);
      if (response.expiresAt) {
        setCacheExpiresAt(new Date(response.expiresAt));
        toast({ title: "Chat session extended", description: "Keeping the document context warm for your questions." });
      }
    } catch (error) {
      toast({
        title: "Cache extension failed",
        description: error instanceof Error ? error.message : "Unable to extend chat session",
        variant: "destructive",
      });
    }
  }, [conversationId, cacheExpiresAt]);

  const isReady = Boolean(book && conversationId && hasActiveCache);

  /**
   * Sends one message into the book's conversation. Both the question and the answer are appended
   * to `messages`. Resolves with the assistant reply, or null when it could not be sent/answered.
   */
  const send = useCallback(
    async (content: string): Promise<ChatMessage | null> => {
      if (!bookRef.current) {
        toast({
          title: "No book selected",
          description: "Please open a book from your library to ask questions.",
          variant: "destructive",
        });
        return null;
      }
      if (!conversationId) {
        toast({ title: "Session not ready", description: "Please wait while we prepare the chat session.", variant: "destructive" });
        return null;
      }
      if (!hasActiveCache) {
        toast({
          title: "Document not ready",
          description: "Please wait for the book to finish uploading before asking questions.",
          variant: "destructive",
        });
        return null;
      }

      await checkAndExtendCache();

      setMessages(prev => [...prev, { id: `${Date.now()}`, content, sender: "human", timestamp: new Date() }]);
      setPendingCount(count => count + 1);
      try {
        const response = await apiService.sendChatMessage({ conversationId, message: content });
        const reply: ChatMessage = {
          id: response.messageId,
          content: response.message,
          sender: "assistant",
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, reply]);
        return reply;
      } catch (error) {
        setMessages(prev => [
          ...prev,
          {
            id: `${Date.now() + 3}`,
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Failed to get a response"}`,
            sender: "assistant",
            timestamp: new Date(),
          },
        ]);
        return null;
      } finally {
        setPendingCount(count => count - 1);
      }
    },
    [conversationId, hasActiveCache, checkAndExtendCache]
  );

  const isLoading = pendingCount > 0;

  // Memoised: the provider re-renders with playback several times a second
  return useMemo(
    () => ({ messages, send, isReady, isLoading, isInitializing, isUploadingBook, hasActiveCache, uploadError }),
    [messages, send, isReady, isLoading, isInitializing, isUploadingBook, hasActiveCache, uploadError]
  );
};

export type BookConversation = ReturnType<typeof useBookConversation>;
