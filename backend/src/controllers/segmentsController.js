const supabaseService = require('../services/supabaseService');
const extractionService = require('../services/extraction/extractionService');
const segmentAudioService = require('../services/audio/segmentAudioService');
const windowService = require('../services/audio/windowService');
const bookModeService = require('../services/bookModeService');
const jobRunner = require('../services/jobs/jobRunner');
const logger = require('../utils/logger');
const config = require('../config');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optionalString = (value) => (typeof value === 'string' && value ? value : null);
const positiveInt = (value) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

// Whether every page in [first, last] has text (pages with no paragraphs, e.g. blank, count)
async function allDone(extraction, first, last) {
  if (first > last) return true;
  const done = new Set(await supabaseService.getDonePageNumbers(extraction.id, first - 1));
  for (let n = first; n <= last; n++) if (!done.has(n)) return false;
  return true;
}

/**
 * Where a listen request starts. fromPage → the paragraph that starts on that page, else the one
 * running across it, else the next one when the pages before it have text. fromSeq → that
 * paragraph, or the next one ("seq + 1" = the paragraph after) unless pages with no text lie
 * between. seq is null when the start has no text yet; page is what the text window is built around.
 */
async function listenStart(extraction, { fromSeq, fromPage }) {
  if (fromPage) {
    const rows = await supabaseService.getSegments(extraction.id, { fromPage, limit: 3 });
    const hit = rows.find((s) => s.start_page === fromPage) || rows[0];
    if (!hit || !(await allDone(extraction, fromPage, hit.start_page - 1))) return { seq: null, page: fromPage };
    return { seq: hit.seq, page: fromPage };
  }
  const seq = fromSeq || 1;
  const [segment] = await supabaseService.getSegmentsFromSeq(extraction.id, seq, 1);
  const previous = segment?.seq === seq ? null : await supabaseService.getSegmentBefore(extraction.id, seq);
  // The paragraph after `previous` is missing or lies past pages that have no text yet
  const next = previous ? previous.end_page + 1 : 1;
  if (!segment || (previous && !(await allDone(extraction, next, segment.start_page - 1)))) return { seq: null, page: next };
  return { seq: segment.seq, page: segment.start_page };
}

function notInListenMode(res) {
  return res.status(409).json({
    error: 'BOOK_NOT_IN_LISTEN_MODE',
    message: 'This book is in Read mode. Switch it to Listen mode to listen to it.',
  });
}

function toSegment(row) {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    startPage: row.start_page,
    endPage: row.end_page,
    parts: row.parts,
    text: row.text,
    sentenceOffsets: row.sentence_offsets,
    charCount: row.char_count,
    footnoteMarkers: row.footnote_markers,
    status: row.status,
  };
}

const segmentsController = {
  /**
   * GET /api/books/:bookId/segments?fromPage=&limit=
   * Segments in seq order that end on or after fromPage (a paragraph that starts on the previous
   * page and continues on fromPage is included); pages without text are gaps between seqs. An
   * 'open' or 'head' segment may still change. `book` gives the known length and, until every page
   * has text, an estimate of the whole (known chars per page with text × pages).
   */
  async getSegments(req, res) {
    try {
      const { bookId } = req.params;
      const hasAccess = await supabaseService.ensureUserHasBookAccess(req.user.id, bookId);
      if (!hasAccess) return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });

      const book = await supabaseService.getBookById(bookId);
      const extraction = await extractionService.findLiveExtraction(book.content_sha256);
      if (!extraction) return res.json({ extractionId: null, segments: [], book: null });

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const counts = await supabaseService.getSegmentCharCounts(extraction.id);
      const knownChars = counts.reduce((sum, row) => sum + row.char_count, 0);
      const fromPage = Math.max(parseInt(req.query.fromPage, 10) || 1, 1);
      const rows = await supabaseService.getSegments(extraction.id, { fromPage, limit });

      const complete = extraction.status === 'complete';
      const pagesTotal = extraction.pages_total || null;
      const estimate = !complete && extraction.pages_done > 0 && pagesTotal
        ? Math.round((knownChars / extraction.pages_done) * pagesTotal)
        : knownChars;
      return res.json({
        extractionId: extraction.id,
        segments: rows.map(toSegment),
        book: { knownChars, totalChars: Math.max(knownChars, estimate), complete, pagesTotal },
      });
    } catch (error) {
      logger.error('Error in getSegments:', error);
      return res.status(500).json({ error: 'SEGMENTS_FAILED', message: 'Failed to read the segments.' });
    }
  },

  /**
   * POST /api/books/:bookId/listen { fromSeq | fromPage, voicePersonaId?, voicePersona? }
   * Queues text for the pages around the start first (O15); a page with no text yet answers
   * stopReason 'processing' with no items, and the player asks again once text lands.
   * Plans the rest of the current page and the next page from fromSeq (never past today's page
   * allowance) and prepares its audio.
   * Returns item statuses only: audio URLs come from GET /api/segments/:id/audio, which counts pages.
   */
  async listen(req, res) {
    try {
      const userId = req.user.id;
      const { bookId } = req.params;
      const hasAccess = await supabaseService.ensureUserHasBookAccess(userId, bookId);
      if (!hasAccess) return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });

      const book = await supabaseService.getBookById(bookId);
      if (await bookModeService.modeFor(userId, book) !== 'listen') return notInListenMode(res);
      const extraction = await extractionService.findLiveExtraction(book.content_sha256);
      if (!extraction) {
        return res.status(409).json({ error: 'BOOK_NOT_PROCESSED', message: 'This book has not been prepared for listening yet.' });
      }

      const start = await listenStart(extraction, {
        fromSeq: positiveInt(req.body?.fromSeq),
        fromPage: positiveInt(req.body?.fromPage),
      });
      // O15: text is prepared only here, for the pages this listener is about to reach
      const { extraction: current, queued } = await extractionService.ensureText({
        extraction,
        page: start.page,
        ahead: config.audio.pagesAhead,
        userId,
      });
      const voice = await segmentAudioService.resolveListenerVoice(userId, {
        voicePersonaId: optionalString(req.body?.voicePersonaId),
        voicePersona: optionalString(req.body?.voicePersona),
      });
      const result = await windowService.listen({
        userId,
        book,
        extraction: current,
        fromSeq: start.seq,
        voice,
      });
      if (result.enqueued || queued.length) jobRunner.wake();
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error('Error in listen:', error);
      return res.status(500).json({ error: 'LISTEN_FAILED', message: 'Failed to prepare the audio.' });
    }
  },

  /**
   * POST /api/books/:bookId/listen/wait { segmentIds, voiceKey, timeoutSeconds? }
   * Holds the request until any listed clip is no longer pending, or up to 25 s. The player sends
   * the clips it is waiting on (voiceKey from /listen) instead of polling each one.
   * Returns { voiceKey, items: [{ segmentId, seq, status, durationSeconds? }], timedOut }.
   */
  async waitForClips(req, res) {
    try {
      const userId = req.user.id;
      const { bookId } = req.params;
      const { clipWaitMaxSeconds, clipWaitMaxSegments } = config.audio;
      const segmentIds = req.body?.segmentIds;
      const voiceKey = req.body?.voiceKey;
      if (!Array.isArray(segmentIds) || !segmentIds.length || segmentIds.length > clipWaitMaxSegments
        || !segmentIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
        return res.status(400).json({ error: 'INVALID_SEGMENT_IDS', message: `segmentIds must be 1 to ${clipWaitMaxSegments} segment ids.` });
      }
      if (typeof voiceKey !== 'string' || !/^[0-9a-f]{64}$/.test(voiceKey)) {
        return res.status(400).json({ error: 'INVALID_VOICE_KEY', message: 'voiceKey must be the voiceKey returned by /listen.' });
      }

      const hasAccess = await supabaseService.ensureUserHasBookAccess(userId, bookId);
      if (!hasAccess) return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });
      const book = await supabaseService.getBookById(bookId);
      if (await bookModeService.modeFor(userId, book) !== 'listen') return notInListenMode(res);
      const extraction = await extractionService.findLiveExtraction(book.content_sha256);
      if (!extraction) {
        return res.status(409).json({ error: 'BOOK_NOT_PROCESSED', message: 'This book has not been prepared for listening yet.' });
      }
      const segments = await supabaseService.getSegmentsByIds(extraction.id, [...new Set(segmentIds)]);
      if (!segments.length) return res.status(404).json({ error: 'SEGMENT_NOT_FOUND', message: 'None of these segments belong to this book.' });

      const seconds = Number(req.body?.timeoutSeconds);
      const timeoutSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, clipWaitMaxSeconds) : clipWaitMaxSeconds;
      let aborted = false;
      // The response closing before we answered = the player went away (req 'close' fires once the body is read)
      res.on('close', () => { if (!res.writableEnded) aborted = true; });

      const result = await windowService.waitForClips({ segments, voiceHash: voiceKey, timeoutMs: timeoutSeconds * 1000, isAborted: () => aborted });
      if (aborted) return undefined;
      return res.json({ voiceKey, ...result });
    } catch (error) {
      logger.error('Error in waitForClips:', error);
      return res.status(500).json({ error: 'WAIT_FAILED', message: 'Failed to check the audio.' });
    }
  },

  /**
   * GET /api/segments/:segmentId/audio?voicePersonaId=&voicePersona=&bookId=
   * The clip of one segment in the listener's voice, from the cache only (never generates).
   * Handing out a ready clip counts its pages toward today's limit (402 DAILY_LIMIT_REACHED when
   * they do not fit). bookId picks the listener's copy when they have several of the same PDF.
   */
  async getSegmentAudio(req, res) {
    try {
      const userId = req.user.id;
      const { segmentId } = req.params;
      const notFound = () => res.status(404).json({ error: 'SEGMENT_NOT_FOUND', message: 'Segment not found.' });
      if (!UUID_PATTERN.test(segmentId)) return notFound();

      const segment = await supabaseService.getSegmentById(segmentId);
      if (!segment) return notFound();
      const extraction = await supabaseService.getExtractionById(segment.extraction_id);
      if (!extraction) return notFound();

      // The listener's book with this content: the one named, or their own / library copy
      let book = null;
      const bookId = optionalString(req.query.bookId);
      if (bookId) {
        if (UUID_PATTERN.test(bookId) && await supabaseService.ensureUserHasBookAccess(userId, bookId)) {
          book = await supabaseService.getBookById(bookId);
          if (book.content_sha256 !== extraction.content_sha256) book = null;
        }
      } else {
        book = await supabaseService.findAccessibleBookByContent(userId, extraction.content_sha256);
      }
      if (!book) return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this segment' });
      if (await bookModeService.modeFor(userId, book) !== 'listen') return notInListenMode(res);

      const voice = await segmentAudioService.resolveListenerVoice(userId, {
        voicePersonaId: optionalString(req.query.voicePersonaId),
        voicePersona: optionalString(req.query.voicePersona),
      });
      const result = await windowService.deliver({ userId, book, segment, voice });
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error('Error in getSegmentAudio:', error);
      return res.status(500).json({ error: 'SEGMENT_AUDIO_FAILED', message: 'Failed to read the segment audio.' });
    }
  },
};

module.exports = segmentsController;
