import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { Book } from "@/contexts/BooksContext";
import { listeningService } from "@/services/listeningService";
import type { ProcessingStatus } from "@/types/segments";

/**
 * Which player a book gets: Listen-mode books get the segment player from the start (it shows
 * "preparing" until page 1 is ready, so playback never switches players mid-book); Read-mode books
 * and books that cannot be extracted keep the page player.
 */
export type PlayerKind = "pending" | "segments" | "legacy";

const POLL_UNTIL_READY_MS = 3000;
const POLL_WHILE_RUNNING_MS = 15000;
const RETRY_MS = 5000;

const isRunning = (status: ProcessingStatus) => status.status === "running" || status.status === "queued";

/**
 * Reads a book's extraction status on open, starts (or resumes) the extraction of a Listen-mode
 * book that has none or stopped part way, and follows it while it runs: every 3 s until page 1 is
 * ready, then every 15 s so new pages' text shows up.
 */
export const useBookProcessing = (book: Book | null) => {
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [player, setPlayer] = useState<PlayerKind>("pending");
  const bookId = book?.id;

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let timer = 0;
    let started = false;
    let seen = false;
    setStatus(null);
    setPlayer("pending");

    const schedule = (ms: number) => {
      timer = window.setTimeout(tick, ms);
    };

    async function tick() {
      let current: ProcessingStatus;
      try {
        current = await listeningService.getProcessing(bookId!);
      } catch (error) {
        if (cancelled) return;
        // Never answered: keep the book usable with the page player
        if (!seen) setPlayer("legacy");
        console.warn("Processing status failed", error);
        schedule(RETRY_MS);
        return;
      }
      if (cancelled) return;
      seen = true;

      if (current.bookMode !== "listen") {
        setStatus(current);
        setPlayer("legacy");
        return;
      }

      if (!started && (current.status === "none" || current.status === "partial")) {
        started = true;
        try {
          await listeningService.startProcessing(bookId!);
          if (current.status === "none") {
            toast({ title: "Preparing this book…", description: "Listening starts in about a minute." });
          }
          if (cancelled) return;
          setPlayer("segments");
          schedule(0);
          return;
        } catch (error) {
          if (cancelled) return;
          console.warn("Could not start processing", error);
          setStatus(current);
          // No extraction can start (e.g. no PDF): the page player still works
          if (current.status === "none") setPlayer("legacy");
          else setPlayer("segments");
          return;
        }
      }

      setStatus(current);
      setPlayer("segments");
      if (isRunning(current)) schedule(current.mode === "segments" ? POLL_WHILE_RUNNING_MS : POLL_UNTIL_READY_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bookId]);

  return { processing: status, player };
};
