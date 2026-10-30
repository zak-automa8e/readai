import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { listeningService } from "@/services/listeningService";
import { useUpdatePlanUsage } from "@/hooks/usePlan";
import type { ListenItem, ListenWindow } from "@/types/segments";
import type { CachedClip } from "./segmentPlaybackUtils";

interface Params {
  bookId: string | null;
  personaRef: MutableRefObject<string | null>;
  clipsRef: MutableRefObject<Map<number, CachedClip>>;
  windowRef: MutableRefObject<ListenWindow | null>;
  sessionRef: MutableRefObject<number>;
  setWindowVersion: Dispatch<SetStateAction<number>>;
  setIsPrefetching: (prefetching: boolean) => void;
}

/** The segment player's clips: wait for one to be ready, fetch its URL (counts its pages), warm the next. */
export const useSegmentClips = ({ bookId, personaRef, clipsRef, windowRef, sessionRef, setWindowVersion, setIsPrefetching }: Params) => {
  const updatePlanUsage = useUpdatePlanUsage();

  /** The URL of a ready clip (counts its pages), from the cache when already fetched. */
  const fetchClip = useCallback(async (item: ListenItem): Promise<CachedClip | "limit" | null> => {
    const cached = clipsRef.current.get(item.seq);
    if (cached) return cached;
    const result = await listeningService.getClip(bookId!, item.segmentId, personaRef.current);
    if (result.ok === false) {
      updatePlanUsage(result.limit);
      return "limit";
    }
    if (result.data.status !== "ready" || !result.data.audioUrl) return null;
    updatePlanUsage(result.data);
    const clip = { url: result.data.audioUrl, duration: result.data.durationSeconds ?? 0 };
    clipsRef.current.set(item.seq, clip);
    return clip;
  }, [bookId, clipsRef, personaRef, updatePlanUsage]);

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
      if (plan === windowRef.current) setWindowVersion((v) => v + 1);
      item = bySeq.get(item.seq) ?? item;
    }
    return item;
  }, [bookId, setWindowVersion, windowRef]);

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
  }, [clipsRef, fetchClip, sessionRef, setIsPrefetching, waitUntilSettled]);

  return { fetchClip, waitUntilSettled, preloadAfter };
};
