import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FitMode, PdfDocument } from "../ReadingRoomContext";

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
const DEFAULT_ZOOM = 100;

/** Space between the page and the pane edge on each side (p-6 on the page wrapper). */
const PAGE_GUTTER_PX = 24;
/** A resize that is not a divider drag (window resize, pane collapse) re-renders once it stops. */
const RESIZE_SETTLE_MS = 150;
const RELEASE_GRACE_MS = 200;

export const viewPrefsKey = (bookId: string) => `readai:room:${bookId}:view`;

const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom)));

interface ViewPrefs {
  fit: FitMode;
  zoom: number;
}

const readViewPrefs = (bookId: string): ViewPrefs | null => {
  try {
    const raw = window.localStorage.getItem(viewPrefsKey(bookId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<ViewPrefs> | null;
    return {
      fit: stored?.fit === "page" ? "page" : "width",
      zoom: typeof stored?.zoom === "number" && Number.isFinite(stored.zoom) ? clampZoom(stored.zoom) : DEFAULT_ZOOM,
    };
  } catch {
    return null;
  }
};

/** Fit mode and zoom for one book, restored from and saved to localStorage. */
export const useViewPrefs = (bookId: string | undefined) => {
  const [initial] = useState(() => (bookId ? readViewPrefs(bookId) : null));
  const [fitMode, setFitMode] = useState<FitMode>(initial?.fit ?? "width");
  const [zoomScale, setZoomState] = useState(initial?.zoom ?? DEFAULT_ZOOM);
  const setZoomScale = useCallback((zoom: number) => setZoomState(clampZoom(zoom)), []);

  useEffect(() => {
    if (!bookId) return;
    try {
      window.localStorage.setItem(viewPrefsKey(bookId), JSON.stringify({ fit: fitMode, zoom: zoomScale }));
    } catch {
      // Storage unavailable (private window, quota): the view still works, it just isn't remembered
    }
  }, [bookId, fitMode, zoomScale]);

  return { fitMode, setFitMode, zoomScale, setZoomScale };
};

interface PaneSize {
  width: number;
  height: number;
}

const fitWidth = (pane: PaneSize | null, aspect: number | null, fitMode: FitMode, zoomScale: number) => {
  if (!pane || !aspect) return null;
  const availWidth = Math.max(0, pane.width - 2 * PAGE_GUTTER_PX);
  const availHeight = Math.max(0, pane.height - 2 * PAGE_GUTTER_PX);
  // react-pdf ignores `height` whenever `width` is set, so fit-page is expressed as a width too
  const base = fitMode === "page" ? Math.min(availWidth, availHeight * aspect) : availWidth;
  return Math.max(1, Math.floor((base * zoomScale) / 100));
};

interface UsePageFitParams {
  paneRef: RefObject<HTMLElement>;
  pdf: PdfDocument | null;
  pageNumber: number;
  fitMode: FitMode;
  zoomScale: number;
  dividerDragging: boolean;
}

/**
 * Page width for the canvas pane.
 * - `displayWidth` follows the pane every frame; the page is CSS-scaled to it.
 * - `renderWidth` is what the PDF canvas is drawn at. It only changes when the pane has settled
 *   (divider released, or 150ms after any other resize), because redrawing on every frame of a drag
 *   blanks the canvas on almost every frame.
 * - `aspect` is width / height of the current page (the previous page's until the new one is known).
 */
export const usePageFit = ({ paneRef, pdf, pageNumber, fitMode, zoomScale, dividerDragging }: UsePageFitParams) => {
  const [livePane, setLivePane] = useState<PaneSize | null>(null);
  const [settledPane, setSettledPane] = useState<PaneSize | null>(null);
  const latestPaneRef = useRef<PaneSize | null>(null);
  const draggingRef = useRef(dividerDragging);
  const settleTimerRef = useRef<number>(0);
  const releasedAtRef = useRef(Number.NEGATIVE_INFINITY);

  const sameSize = (a: PaneSize | null, b: PaneSize) =>
    a !== null && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

  useEffect(() => {
    const element = paneRef.current;
    if (!element) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const size = { width: element.clientWidth, height: element.clientHeight };
      if (sameSize(latestPaneRef.current, size)) return;
      const isFirst = latestPaneRef.current === null;
      latestPaneRef.current = size;
      setLivePane(size);
      window.clearTimeout(settleTimerRef.current);
      // The drag's last size can be measured a frame after release; it still redraws at once
      const justReleased = performance.now() - releasedAtRef.current < RELEASE_GRACE_MS;
      if (isFirst || (justReleased && !draggingRef.current)) {
        setSettledPane(size);
      } else if (!draggingRef.current) {
        settleTimerRef.current = window.setTimeout(() => setSettledPane(size), RESIZE_SETTLE_MS);
      }
    };
    // One measurement per frame while a divider is dragged
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    measure();

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settleTimerRef.current);
    };
  }, [paneRef]);

  // Releasing a divider redraws at once instead of waiting for the settle delay
  useEffect(() => {
    const wasDragging = draggingRef.current;
    draggingRef.current = dividerDragging;
    if (wasDragging && !dividerDragging) releasedAtRef.current = performance.now();
    if (!dividerDragging && latestPaneRef.current) {
      window.clearTimeout(settleTimerRef.current);
      const size = latestPaneRef.current;
      setSettledPane(prev => (sameSize(prev, size) ? prev : size));
    }
  }, [dividerDragging]);

  const aspectCacheRef = useRef(new Map<number, number>());
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!pdf) return;
    const cached = aspectCacheRef.current.get(pageNumber);
    if (cached) {
      setAspect(cached);
      return;
    }
    let cancelled = false;
    pdf
      .getPage(pageNumber)
      .then(page => {
        const viewport = page.getViewport({ scale: 1 });
        const value = viewport.width / viewport.height;
        aspectCacheRef.current.set(pageNumber, value);
        if (!cancelled) setAspect(value);
      })
      .catch(() => {
        // The visible <Page> reports load errors itself
      });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);

  const displayWidth = useMemo(() => fitWidth(livePane, aspect, fitMode, zoomScale), [livePane, aspect, fitMode, zoomScale]);
  const renderWidth = useMemo(
    () => fitWidth(settledPane, aspect, fitMode, zoomScale),
    [settledPane, aspect, fitMode, zoomScale]
  );

  return { displayWidth, renderWidth, aspect };
};
