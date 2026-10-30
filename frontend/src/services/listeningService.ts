import type { BookMode, Clip, ClipWait, DailyLimitReached, ListenWindow, PlanUsage, ProcessingStatus, SegmentsPage } from "@/types/segments";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const authHeaders = (): Record<string, string> => {
  try {
    const session = JSON.parse(localStorage.getItem("readai_session") || "null");
    if (session?.access_token && session.expires_at > Date.now() / 1000) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    // No usable session: the request goes out unauthenticated and the API answers 401
  }
  return {};
};

export class ListeningApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.message === "string" ? body.message : `Request failed (${status})`);
  }

  get code() {
    return typeof this.body.error === "string" ? this.body.error : undefined;
  }
}

/** A 402 is an answer, not a failure: the caller shows the daily-limit state. */
export type Limited<T> = { ok: true; data: T } | { ok: false; limit: DailyLimitReached };

async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ListeningApiError(response.status, body ?? {});
  return body as T;
}

async function limited<T>(path: string, init: RequestInit = {}): Promise<Limited<T>> {
  try {
    return { ok: true, data: await request<T>(path, init) };
  } catch (error) {
    if (error instanceof ListeningApiError && error.status === 402) {
      return { ok: false, limit: error.body as unknown as DailyLimitReached };
    }
    throw error;
  }
}

/**
 * The listening endpoints of the audio pipeline (spec §4, story 7a). Clip URLs only come from
 * getClip, which counts the clip's pages toward today's limit; everything else is free.
 */
export const listeningService = {
  getProcessing: (bookId: string) => request<ProcessingStatus>(`/books/${bookId}/processing`),

  /** Read or Listen for this reader; switching to Listen does not start the extraction. */
  setMode: (bookId: string, mode: BookMode) =>
    request<{ mode: BookMode }>(`/books/${bookId}/mode`, { method: "PUT", body: JSON.stringify({ mode }) }),

  startProcessing: (bookId: string, fromPage?: number) =>
    request<{ extractionId: string; status: string }>(`/books/${bookId}/process`, {
      method: "POST",
      body: JSON.stringify(fromPage ? { fromPage } : {}),
    }),

  getSegments: (bookId: string, fromPage: number, limit = 200) =>
    request<SegmentsPage>(`/books/${bookId}/segments?fromPage=${fromPage}&limit=${limit}`),

  /** Segments from the one holding character `atChar` of the book (a click on the book-wide bar). */
  getSegmentsAtChar: (bookId: string, atChar: number, limit = 200) =>
    request<SegmentsPage>(`/books/${bookId}/segments?atChar=${Math.max(Math.floor(atChar), 0)}&limit=${limit}`),

  /**
   * Plan from fromSeq (the rest of that page and the next ones) and queue its audio; or from
   * fromPage when that page has no text yet. Either way the server queues the text ahead (O15).
   */
  listen: (bookId: string, fromSeq: number | null, voicePersonaId: string | null, fromPage?: number) =>
    limited<ListenWindow>(`/books/${bookId}/listen`, {
      method: "POST",
      body: JSON.stringify({
        ...(fromPage ? { fromPage } : { fromSeq }),
        ...(voicePersonaId ? { voicePersonaId } : {}),
      }),
    }),

  /** Held by the server until one of these clips is no longer pending (≤ 25 s). */
  waitForClips: (bookId: string, segmentIds: string[], voiceKey: string, signal?: AbortSignal) =>
    request<ClipWait>(`/books/${bookId}/listen/wait`, {
      method: "POST",
      body: JSON.stringify({ segmentIds, voiceKey }),
      signal,
    }),

  getClip: (bookId: string, segmentId: string, voicePersonaId: string | null) => {
    const query = new URLSearchParams({ bookId });
    if (voicePersonaId) query.set("voicePersonaId", voicePersonaId);
    return limited<Clip>(`/segments/${segmentId}/audio?${query}`);
  },

  /** The plan and today's count; reading it counts nothing. */
  getPlan: () => request<PlanUsage>("/plan"),

  saveReadingPosition: (bookId: string, lastReadPage: number) =>
    request<unknown>(`/books/${bookId}/progress`, {
      method: "PUT",
      body: JSON.stringify({ last_read_page: lastReadPage }),
    }),
};
