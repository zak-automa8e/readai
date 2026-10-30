import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import { listeningService } from "@/services/listeningService";
import type { BookLength, ListenWindow, Segment, SegmentsPage } from "@/types/segments";
import type { CachedClip } from "./segmentPlaybackUtils";
import { SEGMENT_PAGE_SIZE } from "./useSegmentText";

interface Params {
  bookId: string | null;
  bookLength: BookLength | null;
  currentSeq: number | null;
  resumeSeq: number | null;
  segmentBySeq: Map<number, Segment>;
  segmentsRef: MutableRefObject<Segment[]>;
  audioCurrentTime: number;
  audioDuration: number;
  windowVersion: number;
  windowRef: MutableRefObject<ListenWindow | null>;
  clipsRef: MutableRefObject<Map<number, CachedClip>>;
  applyPage: (page: SegmentsPage, replace: boolean) => Segment[];
  playFrom: (seq: number, offsetChars?: number) => void;
}

/** The whole book as one timeline for the segment player's book-wide bar. */
export const useBookTimeline = ({
  bookId,
  bookLength,
  currentSeq,
  resumeSeq,
  segmentBySeq,
  segmentsRef,
  audioCurrentTime,
  audioDuration,
  windowVersion,
  windowRef,
  clipsRef,
  applyPage,
  playFrom,
}: Params) => {
  const bookLengthRef = useRef(bookLength);
  bookLengthRef.current = bookLength;

  /**
   * Position in the whole book, in characters (most of its audio does not exist yet): played =
   * where the reading is, ready = the end of the clips ready right after it (the bar's lighter part).
   */
  const bookProgress = useMemo(() => {
    if (!bookLength || bookLength.totalChars <= 0) return null;
    void windowVersion; // window statuses live in a ref; this re-reads them when they change
    const anchorSeq = currentSeq ?? resumeSeq;
    const current = anchorSeq !== null ? segmentBySeq.get(anchorSeq) : undefined;
    const fraction = current && currentSeq !== null && audioDuration > 0 ? Math.min(audioCurrentTime / audioDuration, 1) : 0;
    const playedChars = current ? current.charStart + fraction * current.charCount : 0;
    let readyChars = playedChars;
    const plan = windowRef.current;
    if (plan && current && currentSeq !== null) {
      for (const item of plan.items) {
        if (item.seq < current.seq) continue;
        const segment = segmentBySeq.get(item.seq);
        if (!segment || (item.status !== "ready" && !clipsRef.current.has(item.seq))) break;
        readyChars = Math.max(readyChars, segment.charStart + segment.charCount);
      }
    }
    return { playedChars, readyChars, ...bookLength };
  }, [bookLength, currentSeq, resumeSeq, segmentBySeq, audioCurrentTime, audioDuration, windowVersion, windowRef, clipsRef]);

  /** Jump to a point of the book (0..1 of its length) and play from the paragraph there. */
  const seekBook = useCallback(async (fraction: number) => {
    const length = bookLengthRef.current;
    if (!bookId || !length || length.knownChars <= 0) return;
    // Past the extracted text: the last known paragraph
    const atChar = Math.min(Math.max(fraction, 0), 1) * length.totalChars;
    const target = Math.min(atChar, length.knownChars - 1);
    const holding = (rows: Segment[]) => rows.find((s) => s.charStart <= target && target < s.charStart + s.charCount);
    let segment = holding(segmentsRef.current);
    if (!segment) {
      const rows = applyPage(await listeningService.getSegmentsAtChar(bookId, target, SEGMENT_PAGE_SIZE), true);
      segment = holding(rows) ?? rows[0];
    }
    if (segment) playFrom(segment.seq, Math.max(Math.round(target - segment.charStart), 0));
  }, [applyPage, bookId, playFrom, segmentsRef]);

  return { bookProgress, seekBook };
};
