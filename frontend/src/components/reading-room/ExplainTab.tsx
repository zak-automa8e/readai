import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Sparkles, StickyNote } from "lucide-react";
import { useNotes } from "@/contexts/NotesContext";
import { Button } from "../ui/button";
import { useReadingRoom } from "./ReadingRoomContext";
import { EXPLAIN_ACTIONS, useAssistant } from "./AssistantContext";

/** Explain tab: the selected passage, quick actions on it, and the latest answer. */
export const ExplainTab = () => {
  const { book } = useReadingRoom();
  const { explainRequest: request, explain, conversation } = useAssistant();
  const { createNote } = useNotes();
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => setSavedId(null), [request?.id]);

  if (!request) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <Sparkles className="h-5 w-5" />
        <p>Select text on the page to explain it.</p>
      </div>
    );
  }

  const { passage, action, status, reply } = request;
  const busy = status === "queued" || status === "sending";

  const handleSave = async () => {
    if (!reply || saving) return;
    setSaving(true);
    try {
      const note = await createNote(book.id, {
        content: reply,
        textSelection: passage.text,
        pageNumber: passage.pageNumber,
      });
      if (note) setSavedId(request.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <figure className="rounded-md border border-border bg-card p-3">
        <figcaption className="mb-1 font-serif text-xs tabular-nums text-muted-foreground">
          Page {passage.pageNumber}
        </figcaption>
        <blockquote dir="auto" className="line-clamp-6 text-start font-serif text-sm leading-relaxed">
          {passage.text}
        </blockquote>
      </figure>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Ask about this passage">
        {EXPLAIN_ACTIONS.map(item => (
          <Button
            key={item.action}
            variant={item.action === action ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2"
            disabled={busy}
            aria-pressed={item.action === action}
            onClick={() => explain(passage, item.action)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card p-3" aria-live="polite">
        {busy && status === "queued" && conversation.uploadError ? (
          <p className="text-sm text-destructive">The book could not be prepared for chat: {conversation.uploadError}</p>
        ) : (
          busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "queued" ? "Preparing the book for chat..." : "Thinking..."}
            </p>
          )
        )}
        {status === "error" && (
          <p className="text-sm text-destructive">No answer this time. Try again, or ask in Chat.</p>
        )}
        {status === "done" && reply && (
          <>
            <div
              dir="auto"
              className="prose prose-sm max-w-none break-words text-start text-sm text-foreground dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply}</ReactMarkdown>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">Also in Chat history</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-2 px-2"
                onClick={handleSave}
                disabled={saving || savedId === request.id}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <StickyNote className="h-4 w-4" />}
                {savedId === request.id ? "Saved" : "Save as note"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
