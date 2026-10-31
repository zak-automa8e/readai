import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { Segment } from "@/types/segments";
import { usePlayback, useReadingRoom } from "./ReadingRoomContext";
import { pageAt } from "./hooks/useSegmentPlayback";
import { SelectionPopover } from "./SelectionPopover";

const TEXT_SELECTOR = "[data-segment-text]";

const pageOfElement = (element: Element) => {
  const page = Number((element.closest("[data-page]") as HTMLElement | null)?.dataset.page);
  return Number.isFinite(page) && page > 0 ? page : null;
};

/** A page's paragraphs; none when no paragraph starts there and `built` says whether it was prepared. */
interface PageSection {
  page: number;
  segments: Segment[];
  built: boolean;
}

/**
 * Every page from the first loaded one (or the page on screen, when it comes before) to the last:
 * text arrives a few pages at a time wherever listeners are, so pages between runs get a section of
 * their own instead of the next run's text running on. A page inside a paragraph from the page
 * before has no section.
 */
const pageSections = (segments: Segment[], builtRuns: [number, number][], pageNumber: number) => {
  const sections: PageSection[] = [];
  const fill = (from: number, to: number) => {
    for (let page = from; page <= to; page++) {
      sections.push({ page, segments: [], built: builtRuns.some(([first, last]) => first <= page && page <= last) });
    }
  };
  if (segments.length) fill(pageNumber, segments[0].startPage - 1);
  let reached = 0;
  for (const segment of segments) {
    const last = sections[sections.length - 1];
    if (last && last.page === segment.startPage) {
      last.segments.push(segment);
    } else {
      if (reached) fill(reached + 1, segment.startPage - 1);
      sections.push({ page: segment.startPage, segments: [segment], built: true });
    }
    reached = Math.max(reached, segment.endPage);
  }
  return sections;
};

// A scroll this soon after the reader's wheel, touch or key is theirs (not the view following a jump)
const USER_SCROLL_MS = 800;
// The page whose section crosses this line below the top of the text is the page being read
const TOP_PROBE_PX = 24;

const pageAtTop = (scroller: HTMLElement, content: HTMLElement) => {
  const probe = scroller.getBoundingClientRect().top + TOP_PROBE_PX;
  let page: number | null = null;
  for (const section of content.querySelectorAll<HTMLElement>("[data-page-start]")) {
    if (page !== null && section.getBoundingClientRect().top > probe) break;
    page = Number(section.dataset.pageStart);
  }
  return page;
};

const PageDivider =({ page }: { page: number }) => (
  <div className="mb-4 mt-6 flex items-center gap-3 text-xs text-muted-foreground first:mt-0" aria-label={`Page ${page}`}>
    <span className="h-px flex-1 bg-border" aria-hidden="true" />
    <span dir="ltr" className="font-sans tabular-nums">p. {page}</span>
    <span className="h-px flex-1 bg-border" aria-hidden="true" />
  </div>
);

interface ParagraphProps {
  segment: Segment;
  /** Index into sentenceOffsets of the sentence being read, -1 when this paragraph is not playing. */
  activeSentence: number;
  onSentence: (seq: number, offset: number) => void;
}

/** One paragraph, split into its sentences; the one being read sits on the highlight. */
const Paragraph = memo(({ segment, activeSentence, onSentence }: ParagraphProps) => {
  const offsets = segment.sentenceOffsets?.length ? segment.sentenceOffsets : [0];
  const sentences = offsets.map((start, i) => ({ start, text: segment.text.slice(start, offsets[i + 1] ?? segment.text.length) }));
  const isHeading = segment.role === "heading";
  const Tag = isHeading ? "h3" : "p";

  return (
    <Tag
      dir="auto"
      data-seq={segment.seq}
      className={
        isHeading
          ? "mb-4 mt-8 text-start font-book text-2xl font-bold leading-relaxed text-foreground"
          : "mb-5 text-start font-book text-xl leading-loose text-foreground"
      }
    >
      {sentences.map((sentence, i) => (
        <span
          key={sentence.start}
          data-segment-text=""
          data-page={pageAt(segment, sentence.start)}
          onClick={() => {
            // A click that ends a drag is a selection, not a jump
            if (!document.getSelection()?.isCollapsed) return;
            onSentence(segment.seq, sentence.start);
          }}
          className={`cursor-pointer rounded-sm transition-colors ${
            i === activeSentence ? "bg-highlight" : "hover:bg-muted"
          }`}
        >
          {sentence.text}
        </span>
      ))}
    </Tag>
  );
});
Paragraph.displayName = "Paragraph";

/**
 * The book's extracted text (audio pipeline story 7.3): paragraphs grouped by the page they start
 * on, unprepared pages held open as blank space, the sentence being read highlighted, a click on a sentence plays from there. Sentence timing
 * is proportional to characters until word timing exists (story 11). Selecting text offers
 * Explain / Save as note, as on the PDF page.
 */
export const ExtractedTextView = ({ visible }: { visible: boolean }) => {
  const { pageNumber, goToPage } = useReadingRoom();
  const playback = usePlayback();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const isSegments = playback.kind === "segments";
  const loaded = isSegments ? playback.segments : null;
  const segments = useMemo(() => loaded ?? [], [loaded]);
  const currentSeq = isSegments ? playback.currentSeq : null;
  const playFrom = isSegments ? playback.playFrom : null;
  const { audioCurrentTime, audioDuration, isPlaying, isReading, processing } = playback;

  const builtRuns = processing?.builtRuns;
  const sections = useMemo(
    () => pageSections(segments, builtRuns ?? [], pageNumber),
    [segments, builtRuns, pageNumber],
  );

  const current = currentSeq !== null ? segments.find((s) => s.seq === currentSeq) : undefined;
  let activeSentence = -1;
  if (current && audioDuration > 0) {
    const charIndex = (audioCurrentTime / audioDuration) * current.charCount;
    const offsets = current.sentenceOffsets?.length ? current.sentenceOffsets : [0];
    activeSentence = offsets.reduce((found, start, i) => (start <= charIndex ? i : found), 0);
  }

  const onSentenceRef = useRef(playFrom);
  onSentenceRef.current = playFrom;
  const onSentence = useMemo(() => (seq: number, offset: number) => onSentenceRef.current?.(seq, offset), []);

  // Keep the paragraph being read in view
  useEffect(() => {
    if (currentSeq === null) return;
    contentRef.current
      ?.querySelector(`[data-seq="${currentSeq}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentSeq]);

  // Not playing: follow page jumps made from the bar or the rail. The page already in view (scrolled
  // to by the reader, or jumped to once its section rendered) is left where the reader has it.
  const shownPageRef = useRef<number | null>(null);
  useEffect(() => {
    if (!visible || isPlaying || pageNumber === shownPageRef.current) return;
    const section = contentRef.current?.querySelector(`[data-page-start="${pageNumber}"]`);
    if (!section) return;
    section.scrollIntoView({ block: "start" });
    shownPageRef.current = pageNumber;
  }, [visible, pageNumber, isPlaying, sections.length]);

  // Not playing: the reader scrolling the text moves the room's page, as a click in the rail does,
  // so the rail follows and play starts where they are reading
  const userScrollAtRef = useRef(0);
  const pointerDownRef = useRef(false);
  const scrollFrameRef = useRef(0);
  const syncRef = useRef({ pageNumber, active: isPlaying || isReading, goToPage });
  syncRef.current = { pageNumber, active: isPlaying || isReading, goToPage };
  const markUserScroll = useCallback(() => {
    userScrollAtRef.current = performance.now();
  }, []);
  const onScroll = useCallback(() => {
    if (!pointerDownRef.current && performance.now() - userScrollAtRef.current > USER_SCROLL_MS) return;
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      const { pageNumber: current, active, goToPage: go } = syncRef.current;
      if (active || !scrollRef.current || !contentRef.current) return;
      const page = pageAtTop(scrollRef.current, contentRef.current);
      if (page === null || page === current) return;
      shownPageRef.current = page;
      go(page);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), []);

  if (!segments.length) {
    const preparing = processing && (processing.status === "running" || processing.status === "queued");
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {preparing ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing the next pages…
          </span>
        ) : (
          "No text for this page yet."
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onWheel={markUserScroll}
      onTouchMove={markUserScroll}
      onKeyDown={markUserScroll}
      onPointerDown={() => (pointerDownRef.current = true)}
      onPointerUp={() => (pointerDownRef.current = false)}
      onPointerCancel={() => (pointerDownRef.current = false)}
      className="h-full min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
    >
      <div ref={contentRef} className="mx-auto max-w-[68ch] px-6 py-8">
        {sections.map((section) => (
          <section key={section.page} data-page-start={section.page}>
            <PageDivider page={section.page} />
            {!section.segments.length && (
              <p className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                {section.built ? "No text on this page." : "This page isn't prepared yet."}
              </p>
            )}
            {section.segments.map((segment) => (
              <Paragraph
                key={segment.seq}
                segment={segment}
                activeSentence={segment.seq === currentSeq ? activeSentence : -1}
                onSentence={onSentence}
              />
            ))}
          </section>
        ))}
      </div>
      <SelectionPopover
        containerRef={contentRef}
        scrollRef={scrollRef}
        textSelector={TEXT_SELECTOR}
        pageOf={pageOfElement}
        clearOnPageChange={false}
      />
    </div>
  );
};
