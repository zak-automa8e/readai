import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Book } from "@/contexts/BooksContext";
import { useBookConversation, type BookConversation } from "./hooks/useBookConversation";

/** A passage the reader selected on the page. */
export interface Passage {
  text: string;
  pageNumber: number;
}

export type ExplainAction = "explain" | "summarise" | "define" | "translate";

export const EXPLAIN_ACTIONS: { action: ExplainAction; label: string }[] = [
  { action: "explain", label: "Explain" },
  { action: "summarise", label: "Summarise" },
  { action: "define", label: "Define" },
  { action: "translate", label: "Translate" },
];

export interface ExplainRequest {
  id: number;
  passage: Passage;
  action: ExplainAction;
  /** queued = waiting for the conversation to be ready */
  status: "queued" | "sending" | "done" | "error";
  reply: string | null;
}

const quote = (text: string) =>
  text
    .split(/\n+/)
    .map(line => `> ${line}`)
    .join("\n");

/** The prompt sent into the book's conversation; it also shows in the Chat tab as the user's message. */
export const composeExplainPrompt = ({ text, pageNumber }: Passage, action: ExplainAction) => {
  const passage = quote(text);
  switch (action) {
    case "summarise":
      return `Summarise this passage from page ${pageNumber} in a few sentences:\n\n${passage}\n\nReply in the language of the passage.`;
    case "define":
      return `Define the key terms and names in this passage from page ${pageNumber}:\n\n${passage}\n\nReply in the language of the passage.`;
    case "translate":
      return `Translate this passage from page ${pageNumber} into English if it is in Arabic, or into Arabic otherwise:\n\n${passage}`;
    default:
      return `Explain this passage from page ${pageNumber}:\n\n${passage}\n\nReply in the language of the passage.`;
  }
};

interface AssistantValue {
  conversation: BookConversation;
  explainRequest: ExplainRequest | null;
  /** Stable. Sends the passage into the book's conversation (queued until the book is ready). */
  explain: (passage: Passage, action?: ExplainAction) => void;
}

const AssistantContext = createContext<AssistantValue | undefined>(undefined);

/** The book's Gemini conversation and the current explain request, shared by every AI pane tab. */
export const AssistantProvider = ({ book, children }: { book: Book | null; children: ReactNode }) => {
  const conversation = useBookConversation(book);
  const [explainRequest, setExplainRequest] = useState<ExplainRequest | null>(null);
  const nextId = useRef(1);

  const explain = useCallback((passage: Passage, action: ExplainAction = "explain") => {
    setExplainRequest({ id: nextId.current++, passage, action, status: "queued", reply: null });
  }, []);

  // A new book starts with no explain request
  const bookId = book?.id;
  useEffect(() => setExplainRequest(null), [bookId]);

  const { isReady, send } = conversation;
  const pendingId = explainRequest?.status === "queued" ? explainRequest.id : null;

  useEffect(() => {
    if (pendingId === null || !isReady || !explainRequest) return;
    const { passage, action } = explainRequest;
    setExplainRequest(current => (current?.id === pendingId ? { ...current, status: "sending" } : current));
    send(composeExplainPrompt(passage, action)).then(reply => {
      setExplainRequest(current =>
        current?.id === pendingId
          ? { ...current, status: reply ? "done" : "error", reply: reply?.content ?? null }
          : current
      );
    });
    // explainRequest is read only for the request that pendingId names
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId, isReady, send]);

  const value = useMemo(() => ({ conversation, explainRequest, explain }), [conversation, explainRequest, explain]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
};

export const useAssistant = () => {
  const context = useContext(AssistantContext);
  if (!context) throw new Error("useAssistant must be used within AssistantProvider");
  return context;
};
