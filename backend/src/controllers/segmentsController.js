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
   * GET /api/books/:bookId/segments?fromPage=&limit=  or  ?atChar=&limit=
   * Segments in seq order that end on or after fromPage (a paragraph that starts on the previous
   * page and continues on fromPage is included), or from the segment holding character atChar of
   * the book (the last one when atChar is past the known text). An 'open' segment may still grow.
   * Each segment carries charStart, its position in the whole book; `book` gives the known length
   * and, while extraction runs, an estimate of the whole (known chars per page × pages).
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
      const starts = new Map();
      let knownChars = 0;
      for (const row of counts) {
        starts.set(row.seq, knownChars);
        knownChars += row.char_count;
      }

      let rows;
      const atChar = parseInt(req.query.atChar, 10);
      if (Number.isInteger(atChar) && atChar >= 0) {
        const hit = counts.find((row) => starts.get(row.seq) + row.char_count > atChar) || counts[counts.length - 1];
        rows = hit ? await supabaseService.getSegmentsFromSeq(extraction.id, hit.seq, limit) : [];
      } else {
        const fromPage = Math.max(parseInt(req.query.fromPage, 10) || 1, 1);
        rows = await supabaseService.getSegments(extraction.id, { fromPage, limit });
      }

      const complete = extraction.status === 'complete';
      const lastPage = counts.length ? counts[counts.length - 1].end_page : 0;
      const estimate = !complete && lastPage > 0 && extraction.pages_total
        ? Math.round((knownChars / lastPage) * extraction.pages_total)
        : knownChars;
      return res.json({
        extractionId: extraction.id,
        segments: rows.map((row) => ({ ...toSegment(row), charStart: starts.get(row.seq) ?? 0 })),
        book: { knownChars, totalChars: Math.max(knownChars, estimate), complete },
      });
    } catch (error) {
      logger.error('Error in getSegments:', error);
      return res.status(500).json({ error: 'SEGMENTS_FAILED', message: 'Failed to read the segments.' });
    }
  },

  /**
   * POST /api/books/:bookId/listen { fromSeq, voicePersonaId?, voicePersona? }
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

      const fromSeq = Math.max(parseInt(req.body?.fromSeq, 10) || 1, 1);
      const voice = await segmentAudioService.resolveListenerVoice(userId, {
        voicePersonaId: optionalString(req.body?.voicePersonaId),
        voicePersona: optionalString(req.body?.voicePersona),
      });
      const result = await windowService.listen({
        userId,
        book,
        extraction,
        fromSeq,
        voice,
      });
      if (result.enqueued) jobRunner.wake();
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
