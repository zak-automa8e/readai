/** One paragraph (or heading) of extracted text: the unit of playback (audio pipeline spec §3). */
export interface Segment {
  id: string;
  seq: number;
  role: string;
  startPage: number;
  endPage: number;
  /** The pages the text comes from, in order, with how many characters each contributes. */
  parts: { page: number; chars: number }[];
  text: string;
  /** Start offset of every sentence in `text` (the first is 0). */
  sentenceOffsets: number[];
  charCount: number;
  footnoteMarkers: string[] | null;
  /** 'open' while its last sentence may still continue on a page not extracted yet. */
  status: "open" | "final";
}

export type ExtractionStatus = "none" | "queued" | "running" | "partial" | "complete" | "failed";

export interface ProcessingStatus {
  extractionId: string | null;
  status: ExtractionStatus;
  bookMode: "listen" | "read";
  pagesTotal: number | null;
  pagesDone: number;
  pagesFailed: number;
  failedPages: number[];
  finalizedThroughPage: number;
  /** 'segments' once page 1's text is final. */
  mode: "segments" | "legacy";
}

/** A clip's state in the shared cache: 'missing' = never queued (ask /listen again). */
export type ClipStatus = "ready" | "pending" | "failed" | "missing";

export interface ListenItem {
  segmentId: string;
  seq: number;
  status: ClipStatus;
  durationSeconds?: number;
}

export interface PlanQuota {
  plan: string;
  limit: number;
  usedToday: number;
  remainingToday: number;
}

export type StopReason = "window" | "allowance" | "processing" | "end" | "scan_limit" | null;

export interface ListenWindow extends PlanQuota {
  voiceKey: string;
  estimatedSeconds: number;
  stopReason: StopReason;
  items: ListenItem[];
  skippedSeqs: number[];
}

export interface ClipWait {
  voiceKey: string;
  items: ListenItem[];
  timedOut: boolean;
}

export interface Clip {
  status: ClipStatus;
  audioUrl?: string;
  durationSeconds?: number;
  voiceKey: string;
}

/** 402 from /listen or /segments/:id/audio: today's page allowance is used up. */
export interface DailyLimitReached {
  error: "DAILY_LIMIT_REACHED";
  message: string;
  used: number;
  limit: number;
  plan: string;
}
