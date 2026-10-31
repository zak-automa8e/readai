import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listeningService } from "@/services/listeningService";
import type { BookLength, ProcessingStatus, Segment, SegmentsPage } from "@/types/segments";
import { sleep } from "./segmentPlaybackUtils";

export const SEGMENT_PAGE_SIZE = 200;
const TEXT_WAIT_MS = 20000;

const covers = (rows: Segment[], page: number) =>
  rows.length > 0 && rows[0].startPage <= page && rows[rows.length - 1].endPage >= page;

/**
 * The segment player's text: the paragraphs loaded around the reader (kept on the page on screen,
 * refreshed as extraction closes more), the book's known length, and waiters for text not there yet.
 */
export const useSegmentText = ({
  bookId,
  pageNumber,
  processing,
}: {
  bookId: string | null;
  pageNumber: number;
  processing: ProcessingStatus | null;
}) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [bookLength, setBookLength] = useState<BookLength | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  segmentsRef.current = segments;
  const pageRef = useRef(pageNumber);
  pageRef.current = pageNumber;
  const textWaitersRef = useRef<(() => void)[]>([]);

  const segmentBySeq = useMemo(() => new Map(segments.map((s) => [s.seq, s])), [segments]);
  const segmentBySeqRef = useRef(segmentBySeq);
  segmentBySeqRef.current = segmentBySeq;

  const applyPage = useCallback((page: SegmentsPage, replace: boolean) => {
    if (page.book) setBookLength(page.book);
    let next = page.segments;
    if (!replace) {
      const merged = new Map(segmentsRef.current.map((s) => [s.seq, s]));
      page.segments.forEach((s) => merged.set(s.seq, s));
      next = [...merged.values()].sort((a, b) => a.seq - b.seq);
    }
    // The refs move at once: a clip started right after this load needs its paragraph
    segmentsRef.current = next;
    segmentBySeqRef.current = new Map(next.map((s) => [s.seq, s]));
    setSegments(next);
    return page.segments;
  }, []);

  const loadSegments = useCallback(async (fromPage: number, replace: boolean) => {
    if (!bookId) return [];
    return applyPage(await listeningService.getSegments(bookId, Math.max(fromPage, 1), SEGMENT_PAGE_SIZE), replace);
  }, [applyPage, bookId]);

  // Keep the text of the page on screen loaded (the reader may jump anywhere)
  useEffect(() => {
    if (!bookId || !processing || processing.mode !== "segments") return;
    if (covers(segmentsRef.current, pageNumber)) return;
    loadSegments(Math.max(pageNumber - 1, 1), true).catch((error) => console.warn("Segments failed", error));
  }, [bookId, pageNumber, processing, loadSegments]);

  // Paragraphs changed somewhere in the book (new pages, or two runs joined): read the loaded range
  // again whole, since a join replaces paragraphs, and wake text waiters
  const segmentVersion = processing?.segmentVersion ?? 0;
  useEffect(() => {
    if (!bookId || segmentVersion < 1) return;
    const loaded = segmentsRef.current;
    loadSegments(loaded[0]?.startPage ?? Math.max(pageRef.current - 1, 1), true)
      .catch((error) => console.warn("Segments failed", error));
    const waiters = textWaitersRef.current;
    textWaitersRef.current = [];
    waiters.forEach((wake) => wake());
  }, [bookId, segmentVersion, loadSegments]);

  /** Resolves when new text lands, or after TEXT_WAIT_MS at the latest. */
  const waitForText = useCallback((signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      textWaitersRef.current.push(resolve);
      void sleep(TEXT_WAIT_MS, signal).then(resolve);
    }), []);

  // Another book (or the player turned off) starts with no text loaded
  useEffect(() => () => setSegments([]), [bookId]);

  return { segments, segmentsRef, segmentBySeq, segmentBySeqRef, bookLength, applyPage, loadSegments, waitForText };
};
