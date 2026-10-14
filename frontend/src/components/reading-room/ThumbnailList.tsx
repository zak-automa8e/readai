import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useReadingRoom, type PdfDocument } from "./ReadingRoomContext";

const THUMB_WIDTH_PX = 120;
/** About two thumbnails above and below the viewport render; everything else is an empty slot. */
const NEAR_MARGIN = "400px 0px";
/** A thumbnail that scrolls past in under this long never starts rendering. */
const RENDER_DELAY_MS = 80;
const FALLBACK_ASPECT = 1 / 1.414;

const useNearViewport = (root: HTMLElement | null) => {
  const ref = useRef<HTMLLIElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!root || !element) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: NEAR_MARGIN,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  return [ref, near] as const;
};

interface PageThumbnailProps {
  pdf: PdfDocument;
  pageNumber: number;
  isCurrent: boolean;
  defaultAspect: number;
  root: HTMLElement | null;
  onSelect: (page: number) => void;
}

/**
 * One slot in the list. The slot always exists (so the scrollbar is the right length); its canvas
 * exists only while the slot is near the viewport. The page image is drawn straight from the shared
 * PDF proxy: react-pdf's <Page> refuses to mount outside its <Document>.
 */
const PageThumbnail = memo(({ pdf, pageNumber, isCurrent, defaultAspect, root, onSelect }: PageThumbnailProps) => {
  const [itemRef, near] = useNearViewport(root);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(defaultAspect);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PdfDocument["getPage"]>>["render"]> | null = null;

    const timer = window.setTimeout(async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (THUMB_WIDTH_PX * ratio) / base.width });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setAspect(base.width / base.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
        if (!cancelled) setDrawn(true);
      } catch {
        // A render cancelled by scrolling away rejects; nothing to report
      }
    }, RENDER_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
      setDrawn(false);
    };
  }, [near, pdf, pageNumber]);

  return (
    <li ref={itemRef} data-page={pageNumber} className="flex flex-col items-center gap-1">
      {/* Wrapper is positioned so a per-page control can be overlaid on the preview later */}
      <div className="relative" style={{ width: THUMB_WIDTH_PX }}>
        <button
          type="button"
          onClick={() => onSelect(pageNumber)}
          tabIndex={isCurrent ? 0 : -1}
          aria-label={`Go to page ${pageNumber}`}
          aria-current={isCurrent ? "page" : undefined}
          className={`block w-full overflow-hidden rounded-sm bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isCurrent ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-muted-foreground"
          }`}
          style={{ aspectRatio: aspect }}
        >
          {near && <canvas ref={canvasRef} className={`block h-full w-full ${drawn ? "" : "invisible"}`} />}
        </button>
      </div>
      <span className={`font-serif text-xs tabular-nums ${isCurrent ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {pageNumber}
      </span>
    </li>
  );
});
PageThumbnail.displayName = "PageThumbnail";

/** Windowed thumbnail strip; the current page is outlined and kept in view. */
export const ThumbnailList = () => {
  const { pdf, numPages, pageNumber, goToPage, panes } = useReadingRoom();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [baseAspect, setBaseAspect] = useState<number | null>(null);
  const hasScrolled = useRef(false);

  // Page 1 sets the slot height for every page that has not drawn yet
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    pdf
      .getPage(1)
      .then(page => {
        const view = page.getViewport({ scale: 1 });
        if (!cancelled) setBaseAspect(view.width / view.height);
      })
      .catch(() => {
        if (!cancelled) setBaseAspect(FALLBACK_ASPECT);
      });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const pages = useMemo(() => Array.from({ length: numPages ?? 0 }, (_, index) => index + 1), [numPages]);

  // Follows prev/next, jumps and auto-play: scroll only when the current slot is not fully visible
  useEffect(() => {
    if (!scroller || baseAspect === null || panes.railCollapsed) return;
    const slot = scroller.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
    if (!slot) return;
    const top = slot.offsetTop;
    const bottom = top + slot.offsetHeight;
    const visible = top >= scroller.scrollTop && bottom <= scroller.scrollTop + scroller.clientHeight;
    if (visible) return;
    const target = top - (scroller.clientHeight - slot.offsetHeight) / 2;
    // Animate only short hops (prev/next, auto-play); a long jump lands at once
    const nearby = Math.abs(target - scroller.scrollTop) < scroller.clientHeight * 2;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: target, behavior: hasScrolled.current && nearby && !reduceMotion ? "smooth" : "auto" });
    hasScrolled.current = true;
  }, [scroller, baseAspect, pageNumber, panes.railCollapsed]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-page]");
    if (!from) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = event.currentTarget.querySelector<HTMLElement>(`[data-page="${Number(from.dataset.page) + step}"] button`);
    if (!next) return;
    event.preventDefault();
    next.focus();
  }, []);

  if (!pdf || !numPages || baseAspect === null) {
    return <p className="p-4 text-sm text-muted-foreground">Loading pages...</p>;
  }

  return (
    <div ref={setScroller} className="relative h-full overflow-y-auto [scrollbar-gutter:stable]">
      <ol aria-label="Pages" onKeyDown={onKeyDown} className="flex flex-col items-center gap-4 p-4">
        {pages.map(page => (
          <PageThumbnail
            key={page}
            pdf={pdf}
            pageNumber={page}
            isCurrent={page === pageNumber}
            defaultAspect={baseAspect}
            root={scroller}
            onSelect={goToPage}
          />
        ))}
      </ol>
    </div>
  );
};
