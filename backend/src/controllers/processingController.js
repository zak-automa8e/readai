const supabaseService = require('../services/supabaseService');
const extractionService = require('../services/extraction/extractionService');
const bookModeService = require('../services/bookModeService');
const jobRunner = require('../services/jobs/jobRunner');
const logger = require('../utils/logger');

function positiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

// Access check + the book row; sends the error response and returns null when the user may not see it
async function loadBook(req, res) {
  const { bookId } = req.params;
  const hasAccess = await supabaseService.ensureUserHasBookAccess(req.user.id, bookId);
  if (!hasAccess) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this book' });
    return null;
  }
  return supabaseService.getBookById(bookId);
}

const processingController = {
  /**
   * POST /api/books/:bookId/process { fromPage? } → 202
   * Starts the extraction of the book's PDF content, or returns the live one (idempotent).
   */
  async startProcessing(req, res) {
    try {
      const userId = req.user.id;
      const book = await loadBook(req, res);
      if (!book) return;

      // O1: Read books are never extracted; O14: the mode is this reader's own
      const userBook = await supabaseService.getUserBook(userId, book.id);
      if ((userBook?.mode || book.mode) !== 'listen') {
        return res.status(409).json({
          error: 'BOOK_NOT_IN_LISTEN_MODE',
          message: 'This book is in Read mode. Switch it to Listen mode to prepare it for listening.',
        });
      }
      if (!book.pdf_url && !book.content_sha256) {
        return res.status(422).json({ error: 'BOOK_HAS_NO_PDF', message: 'This book has no PDF to process.' });
      }

      const contentSha256 = await extractionService.ensureContentHash(book);
      let fromPage = positiveInt(req.body?.fromPage);
      if (!fromPage) fromPage = positiveInt(userBook?.last_read_page) || 1;

      const { extraction, reused } = await extractionService.startOrResume({
        book: { ...book, content_sha256: contentSha256 },
        userId,
        fromPage,
      });
      jobRunner.wake();

      // Another upload of the same PDF learns its page count from the shared extraction
      if (extraction.pages_total && book.total_pages !== extraction.pages_total) {
        supabaseService.updateBook(book.id, { total_pages: extraction.pages_total }).catch((error) => {
          logger.warn('Could not write total_pages', { bookId: book.id, error: error.message });
        });
      }

      logger.info('Processing requested', { bookId: book.id, userId, extractionId: extraction.id, reused, fromPage });
      return res.status(202).json({
        extractionId: extraction.id,
        status: extraction.status,
        pagesTotal: extraction.pages_total,
        pagesDone: extraction.pages_done,
        pagesFailed: extraction.pages_failed,
        finalizedThroughPage: extraction.finalized_through_page,
        reused,
      });
    } catch (error) {
      logger.error('Error in startProcessing:', error);
      return res.status(500).json({ error: 'PROCESSING_FAILED', message: 'Failed to start processing this book.' });
    }
  },

  /**
   * GET /api/books/:bookId/processing
   * mode 'segments' once at least page 1 is finalised; 'legacy' otherwise (or with no extraction).
   */
  async getProcessing(req, res) {
    try {
      const book = await loadBook(req, res);
      if (!book) return;

      const bookMode = await bookModeService.modeFor(req.user.id, book);
      const extraction = await extractionService.findLiveExtraction(book.content_sha256);
      if (!extraction) {
        return res.json({
          extractionId: null,
          status: 'none',
          bookMode,
          pagesTotal: book.total_pages ?? null,
          pagesDone: 0,
          pagesFailed: 0,
          failedPages: [],
          finalizedThroughPage: 0,
          mode: 'legacy',
        });
      }
      return res.json({ ...(await extractionService.getStatus(extraction)), bookMode });
    } catch (error) {
      logger.error('Error in getProcessing:', error);
      return res.status(500).json({ error: 'PROCESSING_STATUS_FAILED', message: 'Failed to read the processing status.' });
    }
  },

  /**
   * PUT /api/books/:bookId/mode { mode: 'read' | 'listen' }
   * Switches Read/Listen for this reader (spec O14). Switching to Listen does not start the
   * extraction: the room asks for it with POST /process, as on any open.
   */
  async setMode(req, res) {
    try {
      const { mode } = req.body || {};
      if (!bookModeService.isMode(mode)) {
        return res.status(400).json({ error: 'INVALID_MODE', message: "mode must be 'read' or 'listen'." });
      }
      const book = await loadBook(req, res);
      if (!book) return;

      await bookModeService.setMode(req.user.id, book, mode);
      logger.info('Book mode set', { bookId: book.id, userId: req.user.id, mode });
      return res.json({ mode });
    } catch (error) {
      logger.error('Error in setMode:', error);
      return res.status(500).json({ error: 'MODE_UPDATE_FAILED', message: 'Failed to switch the book mode.' });
    }
  },
};

module.exports = processingController;
