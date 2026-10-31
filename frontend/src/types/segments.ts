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
  /**
   * 'open' while its last sentence may still continue on a page with no text yet; 'head' while it
   * may continue the page before (that page has no text yet). Seqs are page × 1000 + index, with
   * gaps where pages have no text.
   */
  status: "open" | "final" | "head";
}

/** The book's length: characters (the progress bar's time estimate) and pages (its positions). */
export interface BookLength {
  knownChars: number;
  /** Estimated from known chars per page with text until every page has text; then knownChars. */
  totalChars: number;
  complete: boolean;
  pagesTotal: number | null;
}

export interface SegmentsPage {
  extractionId: string | null;
  segments: Segment[];
  book: BookLength | null;
}

export type ExtractionStatus = "none" | "queued" | "running" | "partial" | "complete" | "failed";

/** Read = the PDF page, chat and notes, no audio; Listen = extracted text and audio. Per reader (spec O14). */
export type BookMode = "read" | "listen";

export interface ProcessingStatus {
  extractionId: string | null;
  status: ExtractionStatus;
  /** This reader's mode: their own choice, else the book's. */
  bookMode: BookMode;
  pagesTotal: number | null;
  pagesDone: number;
  pagesFailed: number;
  failedPages: number[];
  finalizedThroughPage: number;
  /** [[first, last], ...] pages whose paragraphs are built (a page outside them has no text yet). */
  builtRuns: [number, number][];
  /** Bumped whenever paragraphs change anywhere in the book: loaded text is read again. */
  segmentVersion: number;
  /** 'segments' once any paragraphs exist. */
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

/** A ready clip also carries today's count after its pages were counted. */
export interface Clip extends Partial<PlanQuota> {
  status: ClipStatus;
  audioUrl?: string;
  durationSeconds?: number;
  voiceKey: string;
}

export interface PlanSummary {
  id: string;
  name: string;
  dailyPageLimit: number;
  priceCents: number;
  currency: string;
}

/** GET /plan: the listener's plan, today's count, when it starts over, and the plans on offer. */
export interface PlanUsage extends PlanQuota {
  name: string;
  resetsAt: string;
  plans: PlanSummary[];
}

/** 402 from /listen or /segments/:id/audio: today's page allowance is used up. */
export interface DailyLimitReached {
  error: "DAILY_LIMIT_REACHED";
  message: string;
  used: number;
  limit: number;
  plan: string;
}
