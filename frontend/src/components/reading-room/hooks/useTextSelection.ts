import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The prompt carries the passage; the backend caps a message at 10 000 characters. */
const MAX_SELECTION_CHARS = 2000;

export interface PageSelection {
  text: string;
  pageNumber: number;
  /** Viewport rectangle of the selected range, kept current while the canvas scrolls. */
  rect: DOMRect;
}

const TOUCH_SETTLE_MS = 350;

const TEXT_LAYER =".react-pdf__Page__textContent";

const elementOf = (node: Node | null) => (node instanceof Element ? node : node?.parentElement ?? null);

// Text layer spans are separated by newlines and runs of spaces; a passage reads as one paragraph.
// PDFs whose fonts lack a Unicode map yield control characters: drop them (nothing left = no popover).
const normalise = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, MAX_SELECTION_CHARS);

/**
 * Tracks a non-empty text selection inside the page's react-pdf text layer. Cleared on page change,
 * on Esc, on a click anywhere outside `keepRef` (the popover) and when the selection collapses.
 */
export const useTextSelection = ({
  pageRef,
  scrollRef,
  keepRef,
  pageNumber,
  settleOnSelectionChange = false,
}: {
  pageRef: RefObject<HTMLElement>;
  scrollRef: RefObject<HTMLElement>;
  keepRef: RefObject<HTMLElement>;
  pageNumber: number;
  /** Also read the selection a moment after it changes (touch devices). */
  settleOnSelectionChange?: boolean;
}) => {
  const [selection, setSelection] = useState<PageSelection | null>(null);
  const rangeRef = useRef<Range | null>(null);
  const pageNumberRef = useRef(pageNumber);
  pageNumberRef.current = pageNumber;

  const clear = useCallback(() => {
    rangeRef.current = null;
    setSelection(null);
  }, []);

  const read = useCallback(() => {
    const page = pageRef.current;
    const current = document.getSelection();
    if (!page || !current || current.isCollapsed || current.rangeCount === 0) return null;

    const anchor = elementOf(current.anchorNode);
    const focus = elementOf(current.focusNode);
    if (!anchor || !focus || !page.contains(anchor) || !page.contains(focus)) return null;
    if (!anchor.closest(TEXT_LAYER) && !focus.closest(TEXT_LAYER)) return null;

    const text = normalise(current.toString());
    if (!text) return null;

    const range = current.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { range, text, rect };
  }, [pageRef]);

  useEffect(() => {
    const update = () => {
      const found = read();
      if (!found) return;
      rangeRef.current = found.range;
      setSelection({ text: found.text, pageNumber: pageNumberRef.current, rect: found.rect });
    };
    // Let the browser settle the selection (a plain click collapses it after mouseup)
    const onPointerUp = () => window.setTimeout(update, 0);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") return;
      update();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !rangeRef.current) return;
      document.getSelection()?.removeAllRanges();
      clear();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (keepRef.current?.contains(event.target as Node)) return;
      clear();
    };
    let settleTimer = 0;
    const onSelectionChange = () => {
      if (rangeRef.current && document.getSelection()?.isCollapsed) clear();
      // A touch selection ends without a pointerup: wait until the handles stop moving
      if (settleOnSelectionChange) {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(update, TOUCH_SETTLE_MS);
      }
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.clearTimeout(settleTimer);
    };
  }, [read, clear, keepRef, settleOnSelectionChange]);

  // Keep the anchor on the text while the canvas or window scrolls/resizes
  const hasSelection = selection !== null;
  useEffect(() => {
    if (!hasSelection) return;
    const scroller = scrollRef.current;
    const reposition = () => {
      const range = rangeRef.current;
      if (!range) return;
      const rect = range.getBoundingClientRect();
      // The text layer was redrawn (zoom, pane resize): the range no longer points at anything
      if (rect.width === 0 && rect.height === 0) {
        clear();
        return;
      }
      setSelection(current => (current ? { ...current, rect } : current));
    };
    scroller?.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      scroller?.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
  }, [hasSelection, scrollRef, clear]);

  // A different page means the selected spans are gone
  useEffect(() => {
    clear();
  }, [pageNumber, clear]);

  return { selection, clear };
};
