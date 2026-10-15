import { useState, useRef, useEffect, useCallback } from "react";
import { TextInput } from "./ui/text-input";
import { User, Bot, Plus, Loader2 } from "lucide-react";
import { useBooks } from "@/contexts/BooksContext";
import { useNotes } from "@/contexts/NotesContext";
import { useAssistant } from "./reading-room/AssistantContext";
import { Button } from "./ui/button";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const bubble = "rounded-md border border-border bg-card p-3";

const PendingBubble = () => (
  <div className={`${bubble} animate-pulse`}>
    <div className="flex items-start gap-3">
      <div className="mt-1 shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      </div>
      <div className="flex-1">
        <div className="mb-2 h-4 w-3/4 rounded bg-muted"></div>
        <div className="h-4 w-1/2 rounded bg-muted"></div>
      </div>
    </div>
  </div>
);

/** Chat tab: a view over the book's shared conversation (see useBookConversation). */
export const ChatWindow = () => {
  const { currentBook } = useBooks();
  const { createNote } = useNotes();
  const { conversation } = useAssistant();
  const { messages, send, isLoading, isInitializing, isUploadingBook, hasActiveCache, uploadError } = conversation;
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const handleSaveAsNote = useCallback(async (messageId: string, content: string) => {
    if (!currentBook?.id || savingNoteId) return;

    setSavingNoteId(messageId);
    try {
      await createNote(currentBook.id, {
        content,
        noteType: 'general',
      });
    } finally {
      setSavingNoteId(null);
    }
  }, [currentBook?.id, createNote, savingNoteId]);

  const handleSubmit = (content: string) => {
    send(content).catch(() => {});
  };

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
          <div className="space-y-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
            {messages.map((message) => (
              <div key={message.id} className={bubble}>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                      {message.sender === "human" ? (
                        <User className="h-4 w-4 text-primary" />
                      ) : (
                        <Bot className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div
                      dir="auto"
                      className="text-start text-sm text-foreground prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1"
                    >
                      {message.sender === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        <p className="m-0 whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                  {message.sender === 'assistant' && currentBook?.id && (
                    <div className="shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => handleSaveAsNote(message.id, message.content)}
                        disabled={savingNoteId === message.id}
                        aria-label="Save as note"
                        title="Save as note"
                      >
                        {savingNoteId === message.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && <PendingBubble />}
            {(isInitializing || isUploadingBook) && <PendingBubble />}
          </div>
        </div>
        <div className="w-full bg-card">
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
