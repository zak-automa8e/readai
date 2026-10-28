import { memo, useEffect, useMemo, useRef } from "react";
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
 * on, the sentence being read highlighted, a click on a sentence plays from there. Sentence timing
 * is proportional to characters until word timing exists (story 11). Selecting text offers
 * Explain / Save as note, as on the PDF page.
 */
export const ExtractedTextView = () => {
  const { pageNumber } = useReadingRoom();
  const playback = usePlayback();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const isSegments = playback.kind === "segments";
  const loaded = isSegments ? playback.segments : null;
  const segments = useMemo(() => loaded ?? [], [loaded]);
  const currentSeq = isSegments ? playback.currentSeq : null;
  const playFrom = isSegments ? playback.playFrom : null;
  const { audioCurrentTime, audioDuration, isPlaying, processing } = playback;

  const groups = useMemo(() => {
    const byPage: { page: number; segments: Segment[] }[] = [];
    for (const segment of segments) {
      const last = byPage[byPage.length - 1];
      if (last && last.page === segment.startPage) last.segments.push(segment);
      else byPage.push({ page: segment.startPage, segments: [segment] });
    }
    return byPage;
  }, [segments]);

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

  // Not playing: follow page jumps made from the bar or the rail
  useEffect(() => {
    if (isPlaying) return;
    contentRef.current?.querySelector(`[data-page-start="${pageNumber}"]`)?.scrollIntoView({ block: "start" });
  }, [pageNumber, isPlaying, groups.length]);

  if (!segments.length) {
    const preparing = processing && (processing.status === "running" || processing.status === "queued");
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {preparing ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing this book… {processing.pagesDone} of {processing.pagesTotal ?? "?"} pages
          </span>
        ) : (
          "No text for this page yet."
        )}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
      <div ref={contentRef} className="mx-auto max-w-[68ch] px-6 py-8">
        {groups.map((group) => (
          <section key={`${group.page}-${group.segments[0].seq}`} data-page-start={group.page}>
            <div className="mb-4 mt-6 flex items-center gap-3 text-xs text-muted-foreground first:mt-0" aria-label={`Page ${group.page}`}>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span dir="ltr" className="font-sans tabular-nums">p. {group.page}</span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            {group.segments.map((segment) => (
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
