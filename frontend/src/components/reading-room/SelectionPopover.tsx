import { useRef, useState, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, StickyNote } from "lucide-react";
import { useNotes } from "@/contexts/NotesContext";
import { useUI } from "@/contexts/UIContext";
import { Button } from "../ui/button";
import { useReadingRoom } from "./ReadingRoomContext";
import { useAssistant } from "./AssistantContext";
import { useTextSelection } from "./hooks/useTextSelection";

const GAP_PX = 8;
const EDGE_PX = 8;
/** Room above the selection needed to place the popover there instead of below it. */
const ABOVE_MIN_PX = 48;
const HALF_WIDTH_PX = 110;

/**
 * Small toolbar anchored to a text selection on the page: Explain (into the book's conversation,
 * shown on the AI pane's Explain tab) or Save as note. A fixed overlay, portalled to <body>.
 * On mobile the same actions sit in a bottom sheet instead of floating over the text.
 */
export const SelectionPopover = ({
  containerRef,
  scrollRef,
  textSelector,
  pageOf,
  clearOnPageChange = true,
}: {
  /** Defaults to the PDF page; the text view passes its own container and text spans. */
  containerRef?: RefObject<HTMLElement>;
  scrollRef?: RefObject<HTMLElement>;
  textSelector?: string;
  pageOf?: (element: Element) => number | null;
  /** The text view keeps its selection when playback turns the page under it. */
  clearOnPageChange?: boolean;
} = {}) => {
  const { book, pageRef, canvasRef, pageNumber, panes } = useReadingRoom();
  const { explain } = useAssistant();
  const { createNote } = useNotes();
  const { isMobile } = useUI();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const paneRef = scrollRef ?? canvasRef;
  const { selection, clear } = useTextSelection({
    pageRef: containerRef ?? pageRef,
    scrollRef: paneRef,
    keepRef: popoverRef,
    pageNumber: clearOnPageChange ? pageNumber : 0,
    settleOnSelectionChange: isMobile,
    textSelector,
    pageOf,
  });

  if (!selection) return null;

  const dismiss = () => {
    document.getSelection()?.removeAllRanges();
    clear();
  };

  const handleExplain = () => {
    explain({ text: selection.text, pageNumber: selection.pageNumber });
    panes.openAITab("explain");
    dismiss();
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const note = await createNote(book.id, {
        content: selection.text,
        textSelection: selection.text,
        pageNumber: selection.pageNumber,
      });
      if (note) dismiss();
    } finally {
      setSaving(false);
    }
  };

  // Keep the page selection while a button is pressed
  const keepSelection = (event: MouseEvent<HTMLDivElement>) => event.preventDefault();

  if (isMobile) {
    return createPortal(
      <div
        ref={popoverRef}
        role="toolbar"
        aria-label="Selected text"
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-[10px] border border-b-0 border-border bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground"
        onMouseDown={keepSelection}
      >
        <div className="mx-auto mb-3 h-2 w-[100px] rounded-full bg-muted" aria-hidden="true" />
        <p dir="auto" className="mb-3 line-clamp-2 text-start text-sm text-muted-foreground">
          {selection.text}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-10 gap-2" onClick={handleExplain}>
            <Sparkles className="h-4 w-4" />
            Explain
          </Button>
          <Button variant="outline" className="h-10 gap-2" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <StickyNote className="h-4 w-4" />}
            Save note
          </Button>
        </div>
      </div>,
      document.body
    );
  }

  // Hide (but keep) the selection while it is scrolled out of the canvas pane
  const pane = paneRef.current?.getBoundingClientRect();
  const { rect } = selection;
  if (pane && (rect.bottom < pane.top || rect.top > pane.bottom)) return null;

  const placeAbove = rect.top - (pane?.top ?? 0) > ABOVE_MIN_PX;
  const centre = Math.min(
    Math.max(rect.left + rect.width / 2, HALF_WIDTH_PX + EDGE_PX),
    window.innerWidth - HALF_WIDTH_PX - EDGE_PX
  );
  const style = placeAbove
    ? { left: centre, top: rect.top - GAP_PX, transform: "translate(-50%, -100%)" }
    : { left: centre, top: rect.bottom + GAP_PX, transform: "translateX(-50%)" };

  return createPortal(
    <div
      ref={popoverRef}
      role="toolbar"
      aria-label="Selected text"
      className="fixed z-50 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground"
      style={style}
      onMouseDown={keepSelection}
    >
      <Button variant="ghost" size="sm" className="h-8 gap-2 px-2" onClick={handleExplain}>
        <Sparkles className="h-4 w-4" />
        Explain
      </Button>
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <Button variant="ghost" size="sm" className="h-8 gap-2 px-2" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <StickyNote className="h-4 w-4" />}
        Save as note
      </Button>
    </div>,
    document.body
  );
};
