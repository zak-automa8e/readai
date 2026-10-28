import { useState } from "react";
import { FileText, AlignJustify } from "lucide-react";
import { usePlayback, useReadingRoom } from "./ReadingRoomContext";
import { PageCanvas } from "./PageCanvas";
import { ExtractedTextView } from "./ExtractedTextView";

type CanvasView = "pdf" | "text";

const storageKey = (bookId: string) => `readai:canvas-view:${bookId}`;

const readChoice = (bookId: string): CanvasView | null => {
  try {
    const value = localStorage.getItem(storageKey(bookId));
    return value === "pdf" || value === "text" ? value : null;
  } catch {
    return null;
  }
};

/**
 * The canvas pane's views. Books on the segment player get a PDF | Text switch; until the reader
 * picks one (remembered per book), Text shows while audio plays and the PDF otherwise. Both views
 * stay mounted so switching never redraws the page or loses the text's scroll position.
 */
export const CanvasViews = ({ fixedFit = false }: { fixedFit?: boolean }) => {
  const { book } = useReadingRoom();
  const { kind, isPlaying, isReading } = usePlayback();
  const [choice, setChoice] = useState<CanvasView | null>(() => readChoice(book.id));

  if (kind !== "segments") return <PageCanvas fixedFit={fixedFit} />;

  const view: CanvasView = choice ?? (isPlaying || isReading ? "text" : "pdf");
  const choose = (next: CanvasView) => {
    setChoice(next);
    try {
      localStorage.setItem(storageKey(book.id), next);
    } catch {
      // Not remembered this time; the switch still works
    }
  };

  const tab = (value: CanvasView, label: string, Icon: typeof FileText) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === value}
      onClick={() => choose(value)}
      className={`flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        view === value ? "bg-card text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-center border-b border-border">
        <div role="tablist" aria-label="View" className="flex items-center gap-1 rounded-md bg-muted p-0.5">
          {tab("pdf", "PDF", FileText)}
          {tab("text", "Text", AlignJustify)}
        </div>
      </div>
      <div className={view === "pdf" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <PageCanvas fixedFit={fixedFit} />
      </div>
      <div className={view === "text" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <ExtractedTextView />
      </div>
    </div>
  );
};
