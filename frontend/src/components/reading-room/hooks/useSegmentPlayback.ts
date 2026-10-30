import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { Book } from "@/contexts/BooksContext";
import { ListeningApiError, listeningService } from "@/services/listeningService";
import { useUpdatePlanUsage } from "@/hooks/usePlan";
import type { DailyLimitReached, ListenWindow, ProcessingStatus } from "@/types/segments";
import { firstSeqOnPage, pageAt, type CachedClip } from "./segmentPlaybackUtils";
import { useSegmentText } from "./useSegmentText";
import { useSegmentClips } from "./useSegmentClips";
import { useBookTimeline } from "./useBookTimeline";

export { pageAt } from "./segmentPlaybackUtils";

/**
 * Segment player (audio pipeline story 7.2). Plays a Listen-mode book paragraph by paragraph:
 *   /listen plans the rest of the page and the next one and queues their clips; /listen/wait holds
 *   until a clip is ready (no polling); GET /segments/:id/audio hands out the URL and counts the
 *   page. The next paragraph's clip is fetched and preloaded while the current one plays, so
 *   playback moves on without a gap. Pages turn as the reading crosses into them.
 */

export type SegmentPlayerStatus = "idle" | "preparing" | "waiting-text" | "playing" | "paused" | "limit" | "ended" | "error";

interface Params {
  enabled: boolean;
  book: Book | null;
  pageNumber: number;
  setPageNumber: (page: number) => void;
  numPages: number | null;
  activePersonaId: string | null;
  processing: ProcessingStatus | null;
  /** The paragraph the listener stopped at last time: play resumes there when it is on this page. */
  resumeSeq: number | null;
  /** The player is waiting for text that is being prepared: follow the extraction closely. */
  onWaitingText: () => void;
}

/** Load more text once the reading is this many paragraphs from the end of what is loaded. */
const PRELOAD_TEXT_MARGIN = 20;
const MAX_REPLANS = 3;
const LIMIT_TOAST = {
  title: "Today's listening limit is reached",
  description: "Reading, the text view and chat still work.",
};

export const useSegmentPlayback = ({
  enabled,
  book,
  pageNumber,
  setPageNumber,
  numPages,
  activePersonaId,
  processing,
  resumeSeq,
  onWaitingText,
}: Params) => {
  const bookId = enabled ? book?.id ?? null : null;
  const updatePlanUsage = useUpdatePlanUsage();

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
  const { segments, segmentsRef, segmentBySeq, segmentBySeqRef, bookLength, applyPage, loadSegments, waitForText } =
    useSegmentText({ bookId, pageNumber, processing });
  /** Bumped when the planned window's clip statuses change (the bar's "ready ahead" part). */
  const [windowVersion, setWindowVersion] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchPageRef = useRef<HTMLDivElement>(null);
  /** Bumped by every new start (play, seek, voice change, stop): older async flows see it and quit. */
  const sessionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const clipsRef = useRef(new Map<number, CachedClip>());
  const windowRef = useRef<ListenWindow | null>(null);
  const currentSeqRef = useRef<number | null>(null);
  currentSeqRef.current = currentSeq;
  const audioDurationRef = useRef(0);
  audioDurationRef.current = audioDuration;
  const personaRef = useRef(activePersonaId);
  personaRef.current = activePersonaId;
  const pageRef = useRef(pageNumber);
  pageRef.current = pageNumber;
  const lastAutoPageRef = useRef<number | null>(null);
  const resumeSeqRef = useRef(resumeSeq);
  resumeSeqRef.current = resumeSeq;
  const runFromRef = useRef<(seq: number | null, offsetChars?: number, fromPage?: number) => Promise<void>>(async () => {});
  const onWaitingTextRef = useRef(onWaitingText);
  onWaitingTextRef.current = onWaitingText;

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
    updatePlanUsage(info);
    toast({ ...LIMIT_TOAST, variant: "destructive" });
  }, [setStatus, stopAudio, updatePlanUsage]);

  // ---------------------------------------------------------------- planning and clips

  const { fetchClip, waitUntilSettled, preloadAfter } = useSegmentClips({
    bookId, personaRef, clipsRef, windowRef, sessionRef, setWindowVersion, setIsPrefetching,
  });

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
  }, [loadSegments, segmentBySeqRef, segmentsRef, setPageNumber, setStatus]);

  /**
   * Plan from seq and play the first playable paragraph at or after it. seq null = `fromPage` has
   * no text yet: /listen queues it (O15) and the player waits there.
   */
  const runFrom = useCallback(async (seq: number | null, offsetChars = 0, fromPage?: number) => {
    if (!bookId) return;
    const session = ++sessionRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const live = () => session === sessionRef.current;
    setLimit(null);

    // Preloaded: play at once, plan the next window in the background
    const cached = seq !== null ? clipsRef.current.get(seq) : undefined;
    if (cached && seq !== null) {
      startClip(seq, cached, offsetChars);
      listeningService.listen(bookId, seq, personaRef.current).then((result) => {
        if (!live()) return;
        if (!result.ok) return; // the next fetchClip reports the limit when it is reached
        windowRef.current = result.data;
        setWindowVersion((v) => v + 1);
        void preloadAfter(seq, result.data, session, signal);
      }).catch((error) => console.warn("Listen failed", error));
      return;
    }

    audioRef.current?.pause();
    setStatus("preparing");
    let fromSeq = seq;
    let atPage = seq === null ? fromPage : undefined;
    try {
      for (let replans = 0; replans <= MAX_REPLANS && live();) {
        const result = await listeningService.listen(bookId, fromSeq, personaRef.current, atPage);
        if (!live()) return;
        if (result.ok === false) return reachLimit(result.limit);
        const plan = result.data;
        windowRef.current = plan;
        setWindowVersion((v) => v + 1);

        if (!plan.items.length) {
          if (plan.stopReason === "processing") {
            setStatus("waiting-text");
            onWaitingTextRef.current();
            await waitForText(signal);
            continue;
          }
          setStatus("ended");
          return;
        }
        atPage = undefined;

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
      // Signed out (the renewal was refused): the sign-in prompt says so, not the player
      if (error instanceof ListeningApiError && error.status === 401) return;
      toast({ title: "Could not play this part", description: "Try again in a moment.", variant: "destructive" });
    }
  }, [bookId, fetchClip, preloadAfter, reachLimit, setStatus, startClip, waitForText, waitUntilSettled]);
  runFromRef.current = runFrom;

  /** The seq to start from on a page: loads that page's text when it is not loaded yet. */
  const seqForPage = useCallback(async (page: number) => {
    const found = firstSeqOnPage(segmentsRef.current, page);
    if (found !== null) return found;
    const rows = await loadSegments(Math.max(page - 1, 1), true);
    // null: the page has no text yet
    return firstSeqOnPage(rows, page);
  }, [loadSegments, segmentsRef]);

  const playPage = useCallback(async (page: number) => {
    const seq = await seqForPage(page);
    await runFromRef.current(seq, 0, seq === null ? page : undefined);
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
    };
  }, [bookId, segmentBySeqRef, setPageNumber, setStatus]);

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
    // Resume where the listener stopped (this visit, else the last one) if that paragraph is on this page
    const seq = currentSeqRef.current ?? resumeSeqRef.current;
    const segment = seq !== null ? segmentBySeqRef.current.get(seq) : undefined;
    if (segment && segment.startPage <= pageRef.current && segment.endPage >= pageRef.current && statusRef.current !== "ended") {
      void runFromRef.current(segment.seq);
    } else {
      void playPage(pageRef.current);
    }
  }, [playPage, segmentBySeqRef]);

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
  }, [segmentBySeqRef]);

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

  // ---------------------------------------------------------------- the whole book as one timeline

  const { bookProgress, seekBook } = useBookTimeline({
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
  });

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
    bookProgress,
    seekBook,
  };
};
