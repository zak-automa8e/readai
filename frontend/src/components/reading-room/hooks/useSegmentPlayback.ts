import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { Book } from "@/contexts/BooksContext";
import { listeningService } from "@/services/listeningService";
import type { DailyLimitReached, ListenItem, ListenWindow, ProcessingStatus, Segment } from "@/types/segments";

/**
 * Segment player (audio pipeline story 7.2). Plays a Listen-mode book paragraph by paragraph:
 *   /listen plans the rest of the page and the next one and queues their clips; /listen/wait holds
 *   until a clip is ready (no polling); GET /segments/:id/audio hands out the URL and counts the
 *   page. The next paragraph's clip is fetched and preloaded while the current one plays, so
 *   playback moves on without a gap. Pages turn as the reading crosses into them.
 */

export type SegmentPlayerStatus = "idle" | "preparing" | "waiting-text" | "playing" | "paused" | "limit" | "ended" | "error";

interface CachedClip {
  url: string;
  duration: number;
}

interface Params {
  enabled: boolean;
  book: Book | null;
  pageNumber: number;
  setPageNumber: (page: number) => void;
  numPages: number | null;
  activePersonaId: string | null;
  processing: ProcessingStatus | null;
}

const SEGMENT_PAGE_SIZE = 200;
/** Load more text once the reading is this many paragraphs from the end of what is loaded. */
const PRELOAD_TEXT_MARGIN = 20;
const MAX_REPLANS = 3;
const TEXT_WAIT_MS = 20000;
const SAVE_POSITION_MS = 5000;
const LIMIT_TOAST = {
  title: "Today's listening limit is reached",
  description: "Reading, the text view and chat still work.",
};

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
function firstSeqOnPage(segments: Segment[], page: number) {
  const starts = segments.find((s) => s.startPage === page);
  if (starts) return starts.seq;
  return segments.find((s) => s.startPage <= page && s.endPage >= page)?.seq ?? null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    });
  });

export const useSegmentPlayback = ({ enabled, book, pageNumber, setPageNumber, numPages, activePersonaId, processing }: Params) => {
  const bookId = enabled ? book?.id ?? null : null;

  const [status, setStatusState] = useState<SegmentPlayerStatus>("idle");
  // The ref moves with the state at once: audio events fired right after a change read the new value
  const statusRef = useRef<SegmentPlayerStatus>("idle");
  const setStatus = useCallback((next: SegmentPlayerStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const [currentSeq, setCurrentSeq] = useState<number | null>(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [limit, setLimit] = useState<DailyLimitReached | null>(null);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchPageRef = useRef<HTMLDivElement>(null);
  /** Bumped by every new start (play, seek, voice change, stop): older async flows see it and quit. */
  const sessionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const clipsRef = useRef(new Map<number, CachedClip>());
  const windowRef = useRef<ListenWindow | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  segmentsRef.current = segments;
  const currentSeqRef = useRef<number | null>(null);
  currentSeqRef.current = currentSeq;
  const audioDurationRef = useRef(0);
  audioDurationRef.current = audioDuration;
  const personaRef = useRef(activePersonaId);
  personaRef.current = activePersonaId;
  const pageRef = useRef(pageNumber);
  pageRef.current = pageNumber;
  const lastAutoPageRef = useRef<number | null>(null);
  const textWaitersRef = useRef<(() => void)[]>([]);
  const runFromRef = useRef<(seq: number, offsetChars?: number) => Promise<void>>(async () => {});

  const segmentBySeq = useMemo(() => new Map(segments.map((s) => [s.seq, s])), [segments]);
  const segmentBySeqRef = useRef(segmentBySeq);
  segmentBySeqRef.current = segmentBySeq;

  // ---------------------------------------------------------------- segments (text) around the reader

  const loadSegments = useCallback(async (fromPage: number, replace: boolean) => {
    if (!bookId) return [];
    const { segments: rows } = await listeningService.getSegments(bookId, Math.max(fromPage, 1), SEGMENT_PAGE_SIZE);
    setSegments((current) => {
      if (replace) return rows;
      const merged = new Map(current.map((s) => [s.seq, s]));
      rows.forEach((s) => merged.set(s.seq, s));
      return [...merged.values()].sort((a, b) => a.seq - b.seq);
    });
    return rows;
  }, [bookId]);

  const covers = (rows: Segment[], page: number) =>
    rows.length > 0 && rows[0].startPage <= page && rows[rows.length - 1].endPage >= page;

  // Keep the text of the page on screen loaded (the reader may jump anywhere)
  useEffect(() => {
    if (!bookId || !processing || processing.mode !== "segments") return;
    if (covers(segmentsRef.current, pageNumber)) return;
    loadSegments(Math.max(pageNumber - 1, 1), true).catch((error) => console.warn("Segments failed", error));
  }, [bookId, pageNumber, processing, loadSegments]);

  // New text landed: refresh the loaded tail if it reached the extraction frontier, wake text waiters
  const finalized = processing?.finalizedThroughPage ?? 0;
  useEffect(() => {
    if (!bookId || finalized < 1) return;
    const loaded = segmentsRef.current;
    const last = loaded[loaded.length - 1];
    if (!last || last.status === "open" || loaded.length < SEGMENT_PAGE_SIZE) {
      loadSegments(loaded[0]?.startPage ?? Math.max(pageRef.current - 1, 1), loaded.length === 0)
        .catch((error) => console.warn("Segments failed", error));
    }
    const waiters = textWaitersRef.current;
    textWaitersRef.current = [];
    waiters.forEach((wake) => wake());
  }, [bookId, finalized, loadSegments]);

  const waitForText = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      textWaitersRef.current.push(resolve);
      void sleep(TEXT_WAIT_MS, signal).then(resolve);
    });

  // ---------------------------------------------------------------- audio element

  const stopAudio = useCallback(() => {
    sessionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setIsPrefetching(false);
  }, []);

  const reachLimit = useCallback((info: DailyLimitReached) => {
    stopAudio();
    setLimit(info);
    setStatus("limit");
    toast({ ...LIMIT_TOAST, variant: "destructive" });
  }, [setStatus, stopAudio]);

  // ---------------------------------------------------------------- planning and clips

  /** The URL of a ready clip (counts its pages), from the cache when already fetched. */
  const fetchClip = useCallback(async (item: ListenItem): Promise<CachedClip | "limit" | null> => {
    const cached = clipsRef.current.get(item.seq);
    if (cached) return cached;
    const result = await listeningService.getClip(bookId!, item.segmentId, personaRef.current);
    if (!result.ok) return "limit";
    if (result.data.status !== "ready" || !result.data.audioUrl) return null;
    const clip = { url: result.data.audioUrl, duration: result.data.durationSeconds ?? 0 };
    clipsRef.current.set(item.seq, clip);
    return clip;
  }, [bookId]);

  /** Wait (held requests, no polling) until `target` is no longer pending. */
  const waitUntilSettled = useCallback(async (target: ListenItem, plan: ListenWindow, signal: AbortSignal) => {
    let item = target;
    const pendingIds = () => plan.items.filter((i) => i.status === "pending").map((i) => i.segmentId);
    while (item.status === "pending" && !signal.aborted) {
      const ids = pendingIds();
      if (!ids.includes(item.segmentId)) ids.unshift(item.segmentId);
      const answer = await listeningService.waitForClips(bookId!, ids.slice(0, 50), plan.voiceKey, signal);
      const bySeq = new Map(answer.items.map((i) => [i.seq, i]));
      plan.items = plan.items.map((i) => bySeq.get(i.seq) ?? i);
      item = bySeq.get(item.seq) ?? item;
    }
    return item;
  }, [bookId]);

  /** Fetch and warm the next paragraph's clip while the current one plays. */
  const preloadAfter = useCallback(async (seq: number, plan: ListenWindow, session: number, signal: AbortSignal) => {
    const next = plan.items.find((i) => i.seq > seq);
    if (!next || clipsRef.current.has(next.seq)) return;
    setIsPrefetching(true);
    try {
      const settled = await waitUntilSettled(next, plan, signal);
      if (session !== sessionRef.current || settled.status !== "ready") return;
      const clip = await fetchClip(settled);
      if (clip && clip !== "limit") {
        const warm = new Audio();
        warm.preload = "auto";
        warm.src = clip.url;
      }
    } catch (error) {
      if (!signal.aborted) console.warn("Preload failed", error);
    } finally {
      if (session === sessionRef.current) setIsPrefetching(false);
    }
  }, [fetchClip, waitUntilSettled]);

  const startClip = useCallback((seq: number, clip: CachedClip, offsetChars: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const segment = segmentBySeqRef.current.get(seq);
    setCurrentSeq(seq);
    currentSeqRef.current = seq;
    // Keep the text loaded ahead of the reading: page turns and the highlight need it
    const loaded = segmentsRef.current;
    const lastLoaded = loaded[loaded.length - 1];
    if (!segment || (lastLoaded && seq > lastLoaded.seq - PRELOAD_TEXT_MARGIN)) {
      loadSegments(segment?.startPage ?? Math.max(pageRef.current - 1, 1), false)
        .catch((error) => console.warn("Segments failed", error));
    }
    if (segment) {
      lastAutoPageRef.current = pageAt(segment, offsetChars);
      if (lastAutoPageRef.current !== pageRef.current) setPageNumber(lastAutoPageRef.current);
    }
    audio.src = clip.url;
    audio.onloadedmetadata = () => {
      const duration = isFinite(audio.duration) ? audio.duration : clip.duration;
      setAudioDuration(duration);
      if (offsetChars > 0 && segment?.charCount) audio.currentTime = (offsetChars / segment.charCount) * duration;
    };
    setStatus("playing");
    audio.play().catch((error) => {
      // Autoplay blocked or the element was reset by a newer start
      if (error?.name !== "AbortError") {
        console.warn("Play failed", error);
        setStatus("paused");
      }
    });
  }, [loadSegments, setPageNumber, setStatus]);

  /** Plan from seq and play the first playable paragraph at or after it. */
  const runFrom = useCallback(async (seq: number, offsetChars = 0) => {
    if (!bookId) return;
    const session = ++sessionRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const live = () => session === sessionRef.current;
    setLimit(null);

    // Preloaded: play at once, plan the next window in the background
    const cached = clipsRef.current.get(seq);
    if (cached) {
      startClip(seq, cached, offsetChars);
      listeningService.listen(bookId, seq, personaRef.current).then((result) => {
        if (!live()) return;
        if (!result.ok) return; // the next fetchClip reports the limit when it is reached
        windowRef.current = result.data;
        void preloadAfter(seq, result.data, session, signal);
      }).catch((error) => console.warn("Listen failed", error));
      return;
    }

    audioRef.current?.pause();
    setStatus("preparing");
    let fromSeq = seq;
    try {
      for (let replans = 0; replans <= MAX_REPLANS && live();) {
        const result = await listeningService.listen(bookId, fromSeq, personaRef.current);
        if (!live()) return;
        if (result.ok === false) return reachLimit(result.limit);
        const plan = result.data;
        windowRef.current = plan;

        if (!plan.items.length) {
          if (plan.stopReason === "processing") {
            setStatus("waiting-text");
            await waitForText(signal);
            continue;
          }
          setStatus("ended");
          return;
        }

        const settled = await waitUntilSettled(plan.items[0], plan, signal);
        if (!live()) return;
        if (settled.status !== "ready") {
          // failed or never queued: /listen queues it again
          replans += 1;
          fromSeq = settled.seq;
          continue;
        }
        const clip = await fetchClip(settled);
        if (!live()) return;
        if (clip === "limit") {
          const quota = { used: plan.usedToday, limit: plan.limit, plan: plan.plan };
          return reachLimit({ error: "DAILY_LIMIT_REACHED", message: LIMIT_TOAST.title, ...quota });
        }
        if (!clip) {
          replans += 1;
          continue;
        }
        startClip(settled.seq, clip, settled.seq === seq ? offsetChars : 0);
        void preloadAfter(settled.seq, plan, session, signal);
        return;
      }
      if (live()) setStatus("error");
    } catch (error) {
      if (!live() || signal.aborted) return;
      console.warn("Playback failed", error);
      setStatus("error");
      toast({ title: "Could not play this part", description: "Try again in a moment.", variant: "destructive" });
    }
  }, [bookId, fetchClip, preloadAfter, reachLimit, setStatus, startClip, waitUntilSettled]);
  runFromRef.current = runFrom;

  /** The seq to start from on a page: loads that page's text when it is not loaded yet. */
  const seqForPage = useCallback(async (page: number) => {
    let found = firstSeqOnPage(segmentsRef.current, page);
    if (found !== null) return found;
    const rows = await loadSegments(Math.max(page - 1, 1), true);
    found = firstSeqOnPage(rows, page);
    if (found !== null) return found;
    // Past the extracted text: start after the last known paragraph and wait there
    return rows.length ? rows[rows.length - 1].seq + 1 : 1;
  }, [loadSegments]);

  const playPage = useCallback(async (page: number) => {
    const seq = await seqForPage(page);
    await runFromRef.current(seq);
  }, [seqForPage]);

  // ---------------------------------------------------------------- the <audio> element and its events

  useEffect(() => {
    if (!bookId) return;
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    const clips = clipsRef.current;

    const onTime = () => {
      setAudioCurrentTime(audio.currentTime);
      const seq = currentSeqRef.current;
      const segment = seq !== null ? segmentBySeqRef.current.get(seq) : undefined;
      if (!segment || !audio.duration || !isFinite(audio.duration)) return;
      // Page turn when the reading crosses into the next page's part of the paragraph
      const page = pageAt(segment, (audio.currentTime / audio.duration) * segment.charCount);
      if (page !== lastAutoPageRef.current) {
        lastAutoPageRef.current = page;
        setPageNumber(page);
      }
    };
    const onEnded = () => {
      const seq = currentSeqRef.current;
      if (seq === null) return;
      const next = windowRef.current?.items.find((i) => i.seq > seq)?.seq ?? seq + 1;
      void runFromRef.current(next);
    };
    const onPause = () => {
      if (statusRef.current === "playing" && !audio.ended) setStatus("paused");
    };
    const onPlay = () => setStatus("playing");

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      sessionRef.current += 1;
      abortRef.current?.abort();
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audioRef.current = null;
      clips.clear();
      windowRef.current = null;
      setStatus("idle");
      setCurrentSeq(null);
      setSegments([]);
    };
  }, [bookId, setPageNumber, setStatus]);

  // A different voice is a different set of clips: re-plan from the same paragraph
  const voiceRef = useRef(activePersonaId);
  useEffect(() => {
    if (voiceRef.current === activePersonaId) return;
    voiceRef.current = activePersonaId;
    clipsRef.current.clear();
    windowRef.current = null;
    const seq = currentSeqRef.current;
    const wasActive = ["playing", "preparing", "waiting-text"].includes(statusRef.current);
    stopAudio();
    if (seq !== null && wasActive) void runFromRef.current(seq);
    else setStatus("idle");
  }, [activePersonaId, setStatus, stopAudio]);

  // Remember where the listener is (debounced; the reading position the library resumes from)
  useEffect(() => {
    if (!bookId || status !== "playing") return;
    const timer = window.setTimeout(() => {
      listeningService.saveReadingPosition(bookId, pageNumber).catch(() => {});
    }, SAVE_POSITION_MS);
    return () => window.clearTimeout(timer);
  }, [bookId, pageNumber, status]);

  // ---------------------------------------------------------------- controls (same shape as the page player)

  const handleReadPage = useCallback((_autoPlay?: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (statusRef.current === "playing") {
      audio.pause();
      return;
    }
    if (statusRef.current === "paused" && audio.src && currentSeqRef.current !== null) {
      void audio.play();
      return;
    }
    if (statusRef.current === "preparing" || statusRef.current === "waiting-text") return;
    const seq = currentSeqRef.current;
    // Resume where the listener stopped if that paragraph is on this page, else start the page
    const segment = seq !== null ? segmentBySeqRef.current.get(seq) : undefined;
    if (segment && segment.startPage <= pageRef.current && segment.endPage >= pageRef.current && statusRef.current !== "ended") {
      void runFromRef.current(segment.seq);
    } else {
      void playPage(pageRef.current);
    }
  }, [playPage]);

  /** Jump to a page: keeps playing from that page's first paragraph when audio was on. */
  const goToPage = useCallback((page: number) => {
    const target = Math.min(Math.max(Math.round(page), 1), numPages || Math.max(Math.round(page), 1));
    const wasActive = ["playing", "preparing", "waiting-text"].includes(statusRef.current);
    lastAutoPageRef.current = target;
    setPageNumber(target);
    if (wasActive) {
      void playPage(target);
    } else if (statusRef.current !== "idle") {
      stopAudio();
      setCurrentSeq(null);
      setStatus("idle");
    }
  }, [numPages, playPage, setPageNumber, setStatus, stopAudio]);

  const handlePrevPage = useCallback(() => goToPage(pageRef.current - 1), [goToPage]);
  const handleNextPage = useCallback((_autoPlay?: boolean) => goToPage(pageRef.current + 1), [goToPage]);

  /** Start (or move) playback at a character of a paragraph: clicking a sentence in the text view. */
  const playFrom = useCallback((seq: number, offsetChars = 0) => {
    if (seq === currentSeqRef.current && audioRef.current?.src && audioDurationRef.current > 0) {
      const segment = segmentBySeqRef.current.get(seq);
      if (segment?.charCount) {
        audioRef.current.currentTime = (offsetChars / segment.charCount) * audioDurationRef.current;
        if (statusRef.current !== "playing") void audioRef.current.play();
        return;
      }
    }
    void runFromRef.current(seq, offsetChars);
  }, []);

  const skipParagraph = useCallback((direction: 1 | -1) => {
    const seq = currentSeqRef.current;
    if (seq === null) return void playPage(pageRef.current);
    if (direction === 1) {
      const next = windowRef.current?.items.find((i) => i.seq > seq)?.seq ?? seq + 1;
      void runFromRef.current(next);
    } else {
      void runFromRef.current(Math.max(seq - 1, 1));
    }
  }, [playPage]);

  const handleSeek = useCallback((percent: number) => {
    const audio = audioRef.current;
    if (!audio || !audioDurationRef.current) return;
    audio.currentTime = (percent / 100) * audioDurationRef.current;
  }, []);

  // Turning the player off (book switched to the page player) stops everything
  useEffect(() => {
    if (!enabled) stopAudio();
  }, [enabled, stopAudio]);

  return {
    kind: "segments" as const,
    // The page player's shape, so the now-playing bar drives either
    isPlaying: status === "playing",
    isReading: status === "preparing" || status === "waiting-text",
    audioDuration,
    audioCurrentTime,
    audioRef,
    autoPlayEnabled: true,
    setAutoPlayEnabled: (_enabled: boolean) => {},
    isPrefetching,
    prefetchPageNumber: null as number | null,
    prefetchPageRef,
    handleReadPage,
    handlePrevPage,
    handleNextPage,
    goToPage,
    redoPage: () => {},
    handleSeek,
    // Segment player only
    status,
    limit,
    segments,
    currentSeq,
    playFrom,
    skipParagraph,
  };
};
