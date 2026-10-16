const supabaseService = require('../services/supabaseService');
const extractionService = require('../services/extraction/extractionService');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

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
};

module.exports = segmentsController;
