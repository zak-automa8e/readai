const supabaseService = require('../services/supabaseService');
const extractionService = require('../services/extraction/extractionService');
const segmentAudioService = require('../services/audio/segmentAudioService');
const windowService = require('../services/audio/windowService');
const jobRunner = require('../services/jobs/jobRunner');
const logger = require('../utils/logger');

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
   * GET /api/books/:bookId/segments?fromPage=&limit=
   * Segments in seq order that end on or after fromPage (a paragraph that starts on the previous
   * page and continues on fromPage is included). An 'open' segment may still grow.
   */
  async getSegments(req, res) {
    try {
      const { bookId } = req.params;
      const hasAccess = await supabaseService.ensureUserHasBookAccess(req.user.id, bookId);
      if (!hasAccess) return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });

      const book = await supabaseService.getBookById(bookId);
      const extraction = await extractionService.findLiveExtraction(book.content_sha256);
      if (!extraction) return res.json({ extractionId: null, segments: [] });

      const fromPage = Math.max(parseInt(req.query.fromPage, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const rows = await supabaseService.getSegments(extraction.id, { fromPage, limit });
      return res.json({ extractionId: extraction.id, segments: rows.map(toSegment) });
    } catch (error) {
      logger.error('Error in getSegments:', error);
      return res.status(500).json({ error: 'SEGMENTS_FAILED', message: 'Failed to read the segments.' });
    }
  },

  /**
   * POST /api/books/:bookId/listen { fromSeq, voicePersonaId?, voicePersona?, windowSeconds? }
   * Plans the next ~600 s from fromSeq (never past today's page allowance) and prepares its audio.
   * Returns item statuses only: audio URLs come from GET /api/segments/:id/audio, which counts pages.
   */
  async listen(req, res) {
    try {
      const userId = req.user.id;
      const { bookId } = req.params;
      const hasAccess = await supabaseService.ensureUserHasBookAccess(userId, bookId);
      if (!hasAccess) return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });

      const book = await supabaseService.getBookById(bookId);
      if (book.mode !== 'listen') return notInListenMode(res);
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
        windowSeconds: req.body?.windowSeconds,
      });
      if (result.enqueued) jobRunner.wake();
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error('Error in listen:', error);
      return res.status(500).json({ error: 'LISTEN_FAILED', message: 'Failed to prepare the audio.' });
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
      if (book.mode !== 'listen') return notInListenMode(res);

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
