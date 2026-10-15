import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, StickyNote } from "lucide-react";
import { useNotes } from "@/contexts/NotesContext";
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
 */
export const SelectionPopover = () => {
  const { book, pageRef, canvasRef, pageNumber, panes } = useReadingRoom();
  const { explain } = useAssistant();
  const { createNote } = useNotes();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const { selection, clear } = useTextSelection({ pageRef, scrollRef: canvasRef, keepRef: popoverRef, pageNumber });

  if (!selection) return null;

  // Hide (but keep) the selection while it is scrolled out of the canvas pane
  const pane = canvasRef.current?.getBoundingClientRect();
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

  return createPortal(
    <div
      ref={popoverRef}
      role="toolbar"
      aria-label="Selected text"
      className="fixed z-50 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground"
      style={style}
      // Keep the page selection while a button is pressed
      onMouseDown={event => event.preventDefault()}
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
