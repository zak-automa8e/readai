import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "./ui/card";
import { TextInput } from "./ui/text-input";
import { User, Bot } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import apiService, { ChatConversationResponseMessage } from "@/services/apiService";
import { useBooks } from "@/contexts/BooksContext";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  content: string;
  sender: 'human' | 'assistant';
  timestamp: Date;
}

export const ChatWindow = () => {
  const { currentBook } = useBooks();
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    content: "Select a book from your library to start a conversation.",
    sender: "assistant",
    timestamp: new Date(),
  }]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isUploadingBook, setIsUploadingBook] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [cacheExpiresAt, setCacheExpiresAt] = useState<Date | null>(null);
  const [hasActiveCache, setHasActiveCache] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const CACHE_EXTENSION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  const mapMessages = useCallback((items: ChatConversationResponseMessage[] = []): Message[] => {
    return items.map((item) => ({
      id: item.id,
      content: item.content,
      sender: item.role === 'user' ? 'human' : 'assistant',
      timestamp: item.created_at ? new Date(item.created_at) : new Date(),
    }));
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => ([
      ...prev,
      {
        id: `system-${Date.now()}`,
        content,
        sender: 'assistant',
        timestamp: new Date(),
      }
    ]));
  }, []);

  const initializeConversation = useCallback(async () => {
    if (!currentBook) {
      setMessages([{
        id: 'no-book',
        content: 'Select a book from your library to start a conversation.',
        sender: 'assistant',
        timestamp: new Date(),
      }]);
      setConversationId(null);
      setHasActiveCache(false);
      setCacheExpiresAt(null);
      setUploadError(null);
      return;
    }

    setIsInitializing(true);
    setUploadError(null);
    setMessages([{
      id: `loading-${currentBook.id}`,
      content: `Loading chat session for "${currentBook.title}"...`,
      sender: 'assistant',
      timestamp: new Date(),
    }]);

    try {
      const response = await apiService.getOrCreateConversation(currentBook.id);
      const { conversation } = response;

      setConversationId(conversation.id);
      setHasActiveCache(conversation.hasActiveCache);
      setCacheExpiresAt(conversation.cacheExpiresAt ? new Date(conversation.cacheExpiresAt) : null);

      const existingMessages = mapMessages(conversation.messages);

      if (existingMessages.length > 0) {
        setMessages(existingMessages);
      } else {
        setMessages([{
          id: `welcome-${conversation.id}`,
          content: `Hi! I'm ready to help with "${currentBook.title}". Ask me anything about this book once I'm done preparing the document context.`,
          sender: 'assistant',
          timestamp: new Date(),
        }]);
      }

      if (!conversation.hasActiveCache) {
        await uploadBookToGemini(conversation.id);
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Failed to initialize chat';
      setUploadError(description);
      toast({
        title: 'Chat unavailable',
        description,
        variant: 'destructive',
      });
    } finally {
      setIsInitializing(false);
    }
  }, [currentBook, mapMessages]);

  const uploadBookToGemini = useCallback(async (conversationIdParam: string) => {
    if (!currentBook) return;
    if (!currentBook.pdf_url) {
      const description = 'This book is missing a PDF URL. Please re-upload the book.';
      setUploadError(description);
      toast({
        title: 'Upload failed',
        description,
        variant: 'destructive',
      });
      return;
    }

    setIsUploadingBook(true);
    setUploadError(null);
    addSystemMessage(`Uploading "${currentBook.title}" to Gemini so we can chat about it...`);

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
      toast({
        title: 'Document ready',
        description: `"${currentBook.title}" is now cached for quick answers.`,
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Failed to prepare the document for chat';
      setUploadError(description);
      addSystemMessage(`I couldn't prepare "${currentBook?.title}" for chat. Please try again.`);
      toast({
        title: 'Upload failed',
        description,
        variant: 'destructive',
      });
    } finally {
      setIsUploadingBook(false);
    }
  }, [currentBook, addSystemMessage]);

  const checkAndExtendCache = useCallback(async () => {
    if (!conversationId || !cacheExpiresAt) {
      return;
    }

    const timeRemaining = cacheExpiresAt.getTime() - Date.now();

    if (timeRemaining > CACHE_EXTENSION_THRESHOLD_MS) {
      return;
    }

    try {
      const response = await apiService.extendCacheLifetime(conversationId);
      if (response.expiresAt) {
        const newExpiry = new Date(response.expiresAt);
  setCacheExpiresAt(newExpiry);
        toast({
          title: 'Chat session extended',
          description: 'Keeping the document context warm for your questions.',
        });
      }
    } catch (error) {
      toast({
        title: 'Cache extension failed',
        description: error instanceof Error ? error.message : 'Unable to extend chat session',
        variant: 'destructive',
      });
    }
  }, [conversationId, cacheExpiresAt]);

  const handleSubmit = async (content: string) => {
    if (!currentBook) {
      toast({
        title: 'No book selected',
        description: 'Please open a book from your library to ask questions.',
        variant: 'destructive',
      });
      return;
    }

    if (!conversationId) {
      toast({
        title: 'Session not ready',
        description: 'Please wait while we prepare the chat session.',
        variant: 'destructive',
      });
      return;
    }

    if (!hasActiveCache) {
      toast({
        title: 'Document not ready',
        description: 'Please wait for the book to finish uploading before asking questions.',
        variant: 'destructive',
      });
      return;
    }

    await checkAndExtendCache();

    // Add user message to the chat
    const userMessageId = Date.now().toString();
    
    setMessages(prevMessages => [
      ...prevMessages,
      {
        id: userMessageId,
        content,
        sender: "human",
        timestamp: new Date(),
      }
    ]);

    try {
      setIsLoading(true);
      const response = await apiService.sendChatMessage({
        conversationId,
        message: content,
      });
      const responseMessage: Message = {
        id: response.messageId,
        content: response.message,
        sender: 'assistant',
        timestamp: new Date(),
      };
      
      // Add assistant response to chat
      setMessages(prevMessages => [
        ...prevMessages,
        responseMessage
      ]);

  } catch (error) {
      
      // Add error message to chat
      setMessages(prevMessages => [
        ...prevMessages,
        {
          id: (Date.now() + 3).toString(),
          content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Failed to get a response"}`,
          sender: "assistant",
          timestamp: new Date(),
        }
      ]);
      
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initializeConversation().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.id]);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollViewportRef.current) {
      const scrollElement = scrollViewportRef.current;
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div 
          className="flex-1 min-h-0 overflow-y-auto"
          ref={scrollViewportRef}
        >
          <div className="space-y-4 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
            {messages.map((message) => (
              <Card key={message.id} className="p-3 lg:p-4 card-gradient">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    {message.sender === "human" ? (
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
                      {message.sender === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        <p className="m-0">{message.content}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/50">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
            {isLoading && (
              <Card className="p-3 lg:p-4 card-gradient animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="h-4 bg-primary/10 rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-primary/10 rounded w-1/2"></div>
                  </div>
                </div>
              </Card>
            )}
            {(isInitializing || isUploadingBook) && (
              <Card className="p-3 lg:p-4 card-gradient animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="h-4 bg-primary/10 rounded w-4/5 mb-2"></div>
                    <div className="h-4 bg-primary/10 rounded w-2/5"></div>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm w-full">
          <TextInput
            placeholder={
              !currentBook
                ? "Open a book to start chatting..."
                : isUploadingBook || isInitializing
                  ? "Preparing your book..."
                  : hasActiveCache
                    ? "Ask a question about this book..."
                    : uploadError
                      ? "Retrying book upload..."
                      : "Preparing the book for chat..."
            }
            onMessageSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
};
