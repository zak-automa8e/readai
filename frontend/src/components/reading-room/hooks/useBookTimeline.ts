import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { BookLength, ListenWindow, Segment } from "@/types/segments";
import type { CachedClip } from "./segmentPlaybackUtils";

interface Params {
  bookLength: BookLength | null;
  numPages: number | null;
  currentSeq: number | null;
  resumeSeq: number | null;
  segmentBySeq: Map<number, Segment>;
  audioCurrentTime: number;
  audioDuration: number;
  windowVersion: number;
  windowRef: MutableRefObject<ListenWindow | null>;
  clipsRef: MutableRefObject<Map<number, CachedClip>>;
  playPage: (page: number) => Promise<void>;
}

/**
 * Where character `charIndex` of `segment` sits in the book, in pages from the start (page 1 is
 * 0..1): its page, plus how far into that page's text it is, from the paragraphs loaded around it.
 */
function pagePosition(segments: Segment[], segment: Segment, charIndex: number) {
  let page = segment.endPage;
  let intoPart = 0;
  let offset = 0;
  for (const part of segment.parts) {
    if (charIndex < offset + part.chars) {
      page = part.page;
      intoPart = charIndex - offset;
      break;
    }
    offset += part.chars;
    intoPart = part.chars;
  }
  let before = intoPart;
  let onPage = 0;
  for (const other of segments) {
    for (const part of other.parts) {
      if (part.page !== page) continue;
      onPage += part.chars;
      if (other.seq < segment.seq) before += part.chars;
    }
  }
  return page - 1 + (onPage > 0 ? Math.min(before / onPage, 1) : 0);
}

/**
 * The whole book as one timeline for the segment player's book-wide bar. Positions are pages (text
 * arrives in runs anywhere in the book, so characters before a point are not known); they are
 * shown as characters at the book's average per page, which the bar turns into time estimates.
 */
export const useBookTimeline = ({
  bookLength,
  numPages,
  currentSeq,
  resumeSeq,
  segmentBySeq,
  audioCurrentTime,
  audioDuration,
  windowVersion,
  windowRef,
  clipsRef,
  playPage,
}: Params) => {
  const pagesTotal = bookLength?.pagesTotal || numPages || 0;
  const pagesTotalRef = useRef(pagesTotal);
  pagesTotalRef.current = pagesTotal;

  /** played = where the reading is; ready = the end of the clips ready right after it (lighter part). */
  const bookProgress = useMemo(() => {
    if (!bookLength || bookLength.totalChars <= 0 || pagesTotal <= 0) return null;
    void windowVersion; // window statuses live in a ref; this re-reads them when they change
    const charsPerPage = bookLength.totalChars / pagesTotal;
    const segments = [...segmentBySeq.values()];
    const anchorSeq = currentSeq ?? resumeSeq;
    const current = anchorSeq !== null ? segmentBySeq.get(anchorSeq) : undefined;
    const fraction = current && currentSeq !== null && audioDuration > 0 ? Math.min(audioCurrentTime / audioDuration, 1) : 0;
    const played = current ? pagePosition(segments, current, fraction * current.charCount) : 0;
    let ready = played;
    const plan = windowRef.current;
    if (plan && current && currentSeq !== null) {
      for (const item of plan.items) {
        if (item.seq < current.seq) continue;
        const segment = segmentBySeq.get(item.seq);
        if (!segment || (item.status !== "ready" && !clipsRef.current.has(item.seq))) break;
        ready = Math.max(ready, pagePosition(segments, segment, segment.charCount));
      }
    }
    return {
      playedChars: played * charsPerPage,
      readyChars: ready * charsPerPage,
      totalChars: bookLength.totalChars,
      complete: bookLength.complete,
    };
  }, [bookLength, pagesTotal, currentSeq, resumeSeq, segmentBySeq, audioCurrentTime, audioDuration, windowVersion, windowRef, clipsRef]);

  /** Jump to a point of the book (0..1 of its pages) and play from the start of the page there. */
  const seekBook = useCallback(async (fraction: number) => {
    const total = pagesTotalRef.current;
    if (total <= 0) return;
    await playPage(Math.min(Math.floor(Math.min(Math.max(fraction, 0), 1) * total) + 1, total));
  }, [playPage]);

  return { bookProgress, seekBook };
};
