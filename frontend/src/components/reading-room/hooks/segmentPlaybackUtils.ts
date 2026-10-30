import type { Segment } from "@/types/segments";

/** A clip URL handed out by GET /segments/:id/audio (its pages are already counted). */
export interface CachedClip {
  url: string;
  duration: number;
}

/** The page the reading is on at `charIndex` of a segment (parts are in reading order). */
export function pageAt(segment: Segment, charIndex: number) {
  let end = 0;
  for (const part of segment.parts || []) {
    end += part.chars;
    if (charIndex < end) return part.page;
  }
  return segment.endPage;
}

/** The first segment to play for a page: the first that starts on it, else the one running across it. */
export function firstSeqOnPage(segments: Segment[], page: number) {
  const starts = segments.find((s) => s.startPage === page);
  if (starts) return starts.seq;
  return segments.find((s) => s.startPage <= page && s.endPage >= page)?.seq ?? null;
}

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
