const config = require('../../config');
const logger = require('../../utils/logger');
const supabaseService = require('../supabaseService');
const planService = require('../plans/planService');
const segmentAudio = require('./segmentAudioService');

/**
 * The listening window (spec §5.3, O8, O12): the segments the listener reaches in the next
 * ~600 s, never past the pages left in today's allowance. Planning prepares audio (enqueues
 * tts_segment jobs) but never counts a page and never hands out a URL; counting happens when
 * GET /segments/:id/audio delivers a clip.
 */

// O8 defaults: never voiced unless the listener asks for them
const DEFAULT_SKIPPED_TYPES = new Set(['cover', 'title', 'copyright', 'blank', 'toc', 'index', 'back_cover', 'dedication', 'author_note']);
// "Read all front matter" (user_books.read_front_matter) brings these back
const FRONT_MATTER_TYPES = new Set(['title', 'copyright', 'dedication', 'author_note', 'toc']);

const SEGMENT_BATCH = 100;
const MAX_SCAN = 2000; // segments looked at per plan (a long run of skipped pages ends here)

/**
 * Whether a page is skipped for this listener: an override wins, then read_front_matter, then the
 * page type default. A page with no type (older prompt) is read.
 * @param {number} page
 * @param {{pageTypes: Map<number, string|null>, readFrontMatter: boolean, overrides: Map<number, boolean>}} rules
 */
function isPageSkipped(page, { pageTypes, readFrontMatter = false, overrides = new Map() }) {
  if (overrides.has(page)) return overrides.get(page) === true;
  const type = pageTypes.get(page);
  if (!type || !DEFAULT_SKIPPED_TYPES.has(type)) return false;
  return !(readFrontMatter && FRONT_MATTER_TYPES.has(type));
}

// The pages a segment touches, ascending: every one counts when its clip is delivered
function pagesOf(segment) {
  const pages = (segment.parts || []).map((part) => part.page).filter((n) => Number.isInteger(n));
  if (!pages.length) pages.push(segment.start_page);
  return [...new Set(pages)].sort((a, b) => a - b);
}

function estimateSeconds(segment) {
  return segment.char_count * config.audio.secondsPerChar;
}

/**
 * Walk segments in seq order and pick the window. Pure: the caller supplies the segments.
 *   - an 'open' segment ends the walk (its text can still change; never synthesised);
 *   - a segment whose start page is skipped is passed over (listed in skippedSeqs);
 *   - a segment that needs more pages not yet counted today than the allowance has left ends the walk;
 *   - the walk ends once the window holds windowSeconds of estimated audio.
 * @param {Object[]} segments rows in seq order (seq, start_page, parts, char_count, status)
 * @param {{isSkipped: (page: number) => boolean, countedPages: Set<number>, remaining: number, windowSeconds: number}} options
 * @returns {{items: {segment: Object, offsetSeconds: number, estimatedSeconds: number, newPages: number[]}[], skippedSeqs: number[], estimatedSeconds: number, newPages: number[], stopReason: 'window'|'allowance'|'processing'|null}}
 *   stopReason null = the segments ran out
 */
function planWindow(segments, { isSkipped, countedPages, remaining, windowSeconds }) {
  const items = [];
  const skippedSeqs = [];
  const planned = new Set();
  let total = 0;

  for (const segment of segments) {
    if (segment.status === 'open') return { items, skippedSeqs, estimatedSeconds: total, newPages: [...planned], stopReason: 'processing' };
    if (isSkipped(segment.start_page)) {
      skippedSeqs.push(segment.seq);
      continue;
    }
    const newPages = pagesOf(segment).filter((page) => !countedPages.has(page) && !planned.has(page));
    if (planned.size + newPages.length > remaining) {
      return { items, skippedSeqs, estimatedSeconds: total, newPages: [...planned], stopReason: 'allowance' };
    }
    newPages.forEach((page) => planned.add(page));
    const seconds = estimateSeconds(segment);
    items.push({ segment, offsetSeconds: total, estimatedSeconds: seconds, newPages });
    total += seconds;
    if (total >= windowSeconds) return { items, skippedSeqs, estimatedSeconds: total, newPages: [...planned], stopReason: 'window' };
  }
  return { items, skippedSeqs, estimatedSeconds: total, newPages: [...planned], stopReason: null };
}

async function skipRules(userId, bookId, extractionId) {
  const [pageTypes, overrides, userBook] = await Promise.all([
    supabaseService.getPageTypes(extractionId),
    supabaseService.getPageSkipOverrides(userId, bookId),
    supabaseService.getUserBook(userId, bookId),
  ]);
  return { pageTypes, overrides, readFrontMatter: Boolean(userBook?.read_front_matter) };
}

/**
 * Plan over the stored segments from fromSeq, reading them in batches until the plan stops.
 */
async function planFromStore(extraction, fromSeq, options) {
  const segments = [];
  let plan = null;
  for (let next = fromSeq; segments.length < MAX_SCAN;) {
    const batch = await supabaseService.getSegmentsFromSeq(extraction.id, next, SEGMENT_BATCH);
    segments.push(...batch);
    plan = planWindow(segments, options);
    if (plan.stopReason || batch.length < SEGMENT_BATCH) break;
    next = batch[batch.length - 1].seq + 1;
  }
  if (!plan.stopReason) {
    // Out of segments: the end of the book, text still being extracted, or the scan cap
    if (segments.length >= MAX_SCAN) plan.stopReason = 'scan_limit';
    else plan.stopReason = extraction.status === 'complete' ? 'end' : 'processing';
  }
  return plan;
}

function clampWindow(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return config.audio.windowSeconds;
  return Math.min(Math.max(n, config.audio.minWindowSeconds), config.audio.maxWindowSeconds);
}

function toItem(segment, row) {
  const item = { segmentId: segment.id, seq: segment.seq, status: row ? row.status : 'pending' };
  if (row?.status === 'ready') item.durationSeconds = Number(row.duration_seconds);
  return item;
}

/**
 * POST /books/:id/listen: plan the window and prepare its audio.
 * @param {{userId: string, book: Object, extraction: Object, fromSeq: number, voice: {snapshot, hash}, windowSeconds?: number}} args
 * @returns {Promise<{status: 200|402, body: Object, enqueued: boolean}>}
 */
async function listen({ userId, book, extraction, fromSeq, voice, windowSeconds }) {
  const seconds = clampWindow(windowSeconds);
  const [usage, rules] = await Promise.all([
    planService.getPlanUsage(userId, { bookId: book.id }),
    skipRules(userId, book.id, extraction.id),
  ]);
  const options = {
    isSkipped: (page) => isPageSkipped(page, rules),
    countedPages: usage.countedPages,
    remaining: usage.remainingToday,
    windowSeconds: seconds,
  };
  const plan = await planFromStore(extraction, fromSeq, options);
  const quota = { plan: usage.plan, limit: usage.limit, usedToday: usage.usedToday, remainingToday: usage.remainingToday };

  if (!plan.items.length && plan.stopReason === 'allowance') {
    // Nothing fits today: report what is already in the cache for the window, prepare nothing
    const unlimited = planWindow((await supabaseService.getSegmentsFromSeq(extraction.id, fromSeq, SEGMENT_BATCH)), { ...options, remaining: Infinity });
    const rows = await segmentAudio.lookup(voice.hash, unlimited.items.map((i) => i.segment.text_sha256));
    const items = unlimited.items
      .filter((i) => rows.has(i.segment.text_sha256))
      .map((i) => toItem(i.segment, rows.get(i.segment.text_sha256)));
    return {
      status: 402,
      enqueued: false,
      body: {
        error: 'DAILY_LIMIT_REACHED',
        message: "Today's listening limit is reached. Reading, the text view and chat still work.",
        used: usage.usedToday,
        limit: usage.limit,
        plan: usage.plan,
        voiceKey: voice.hash,
        items,
      },
    };
  }

  const before = await segmentAudio.ensureClips(
    plan.items.map((i) => ({ segment: i.segment, priority: i.offsetSeconds })),
    voice,
    { bookId: book.id, userId, extractionId: extraction.id },
  );
  const items = plan.items.map((i) => {
    const row = before.get(i.segment.text_sha256);
    return toItem(i.segment, row?.status === 'ready' ? row : null);
  });
  const enqueued = items.some((item) => item.status !== 'ready');

  logger.info('Listening window planned', {
    userId,
    bookId: book.id,
    fromSeq,
    voiceHash: voice.hash,
    items: items.length,
    ready: items.filter((item) => item.status === 'ready').length,
    newPages: plan.newPages.length,
    stopReason: plan.stopReason,
  });

  return {
    status: 200,
    enqueued,
    body: {
      voiceKey: voice.hash,
      estimatedSeconds: Math.round(plan.estimatedSeconds),
      stopReason: plan.stopReason,
      ...quota,
      items,
      skippedSeqs: plan.skippedSeqs,
    },
  };
}

function limitReached({ used, limit, plan }) {
  return {
    status: 402,
    body: {
      error: 'DAILY_LIMIT_REACHED',
      message: "Today's listening limit is reached. Reading, the text view and chat still work.",
      used,
      limit,
      plan,
    },
  };
}

/**
 * GET /segments/:id/audio: the only place a clip URL is handed out. Cache only, never generates.
 * A ready clip counts every page of the segment toward today's limit (a page already counted today
 * is free); when the pages do not fit, nothing is counted and no URL is returned (402).
 * @param {{userId: string, book: Object, segment: Object, voice: {hash: string}}} args
 * @returns {Promise<{status: 200|402, body: Object}>}
 */
async function deliver({ userId, book, segment, voice }) {
  const row = await supabaseService.getSegmentAudio(segment.text_sha256, voice.hash);
  if (!row || row.status !== 'ready') {
    return { status: 200, body: { status: row ? row.status : 'missing', cached: false, voiceKey: voice.hash } };
  }

  const pages = pagesOf(segment);
  const usage = await planService.getPlanUsage(userId, { bookId: book.id });
  const newPages = pages.filter((page) => !usage.countedPages.has(page));
  // Checked first so a segment that does not fit counts none of its pages
  if (newPages.length > usage.remainingToday) {
    return limitReached({ used: usage.usedToday, limit: usage.limit, plan: usage.plan });
  }
  const recorded = await planService.recordPageListens(userId, book.id, pages);
  if (!recorded.allowed) return limitReached(recorded);

  const used = recorded.used ?? usage.usedToday;
  const limit = recorded.limit ?? usage.limit;
  if (recorded.counted.length) {
    logger.info('Pages counted toward the daily limit', { userId, bookId: book.id, pages: recorded.counted, used, limit });
  }
  return {
    status: 200,
    body: {
      status: 'ready',
      audioUrl: row.audio_url,
      durationSeconds: Number(row.duration_seconds),
      format: row.audio_format,
      cached: true,
      voiceKey: voice.hash,
      plan: recorded.plan ?? usage.plan,
      limit,
      usedToday: used,
      remainingToday: Math.max(limit - used, 0),
      countedPages: recorded.counted,
    },
  };
}

module.exports = {
  DEFAULT_SKIPPED_TYPES,
  FRONT_MATTER_TYPES,
  isPageSkipped,
  pagesOf,
  estimateSeconds,
  planWindow,
  clampWindow,
  listen,
  deliver,
};
